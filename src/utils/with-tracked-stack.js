function addTrackedStackToError(error) {
  globalThis.withTrackedStack?.addTrackedStackToError(error)
}

async function withTrackedStack(...args) {
  const withTrackedStack = globalThis.withTrackedStack?.withTrackedStack

  let callback

  if (args[1]) {
    callback = args[1]
  } else {
    callback = args[0]
  }

  if (withTrackedStack) {
    return await withTrackedStack(...args)
  } else {
    return await callback()
  }
}

export {addTrackedStackToError, withTrackedStack}
