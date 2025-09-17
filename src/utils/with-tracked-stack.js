function addTrackedStackToError(error) {
  globalThis.withTrackedStack?.addTrackedStackToError(error)
}

async function withTrackedStack(...args) {
  const withTrackedStack = globalThis.withTrackedStack?.withTrackedStack

  if (withTrackedStack) {
    return await withTrackedStack(...args)
  } else {
    return await callback()
  }
}

export {addTrackedStackToError, withTrackedStack}
