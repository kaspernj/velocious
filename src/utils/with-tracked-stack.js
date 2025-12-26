// @ts-check

/** @param {Error} error */
function addTrackedStackToError(error) {
  globalThis.withTrackedStack?.addTrackedStackToError(error)
}

/**
 * @param  {...any} args
 * @returns {Promise<any>} - Result.
 */
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
