// @ts-check

import {AsyncLocalStorage} from "node:async_hooks"

/**
 * Defines asyncLocalStorage.
 * @type {import("node:async_hooks").AsyncLocalStorage<Array<string[]>> | undefined} */
let asyncLocalStorage

/**
 * Tracked stack global.
 * @type {{withTrackedStack?: {addTrackedStackToError: (error: Error) => void, withTrackedStack: (arg1: string | (() => Promise<?>), arg2?: (() => Promise<?>) | Error) => Promise<?>}}} */
const trackedStackGlobal = /**
                            * Narrows the runtime value to the documented type.
                            * @type {?} */ (globalThis)

if (AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage()
}

/**
 * Runs add tracked stack to error.
 * @param {Error} error - Error to annotate with a tracked stack.
 */
function addTrackedStackToError(error) {
  // Not supported
  if (!asyncLocalStorage) return

  const parentStacks = asyncLocalStorage.getStore() || []
  const additionalStackLines = []

  for (const parentStack of parentStacks) {
    for (const parentStackLine of parentStack) {
      additionalStackLines.push(parentStackLine)
    }
  }

  // Replace the error message on the first line with this string
  error.stack += "\n" + additionalStackLines.join("\n")
}

/**
 * Runs with tracked stack.
 * @param {(() => Promise<?>) | string} arg1 - Arg1.
 * @param {(() => Promise<?>) | Error} [arg2] - Arg2.
 * @returns {Promise<?>} - Resolves with the callback result.
 */
async function withTrackedStack(arg1, arg2) {
  /**
   * Defines callback.
   * @type {() => Promise<?>} */
  let callback

  /**
   * Defines stack.
   * @type {string} */
  let stack

  if (typeof arg2 == "function" && typeof arg1 == "string") {
    callback = /**
                * Narrows the runtime value to the documented type.
                * @type {() => Promise<?>} */ (arg2)
    stack = arg1
  } else {
    callback = /**
                * Narrows the runtime value to the documented type.
                * @type {() => Promise<?>} */ (arg1)
    stack = Error().stack || ""
  }

  // Not supported
  if (!asyncLocalStorage) return await callback()

  const parentStacks = asyncLocalStorage.getStore() || []
  const additionalStackLines = []
  const currentStackLines = stack.split("\n")

  currentStackLines[0] = "    [WITH TRACKED STACK]"

  for (let i = currentStackLines.length; i >= 0; i--) {
    const stackLine = currentStackLines[i]

    additionalStackLines.unshift(stackLine)

    if (stackLine == "    [WITH TRACKED STACK]") {
      break
    }
  }

  const newStacks = [additionalStackLines, ...parentStacks]

  return await asyncLocalStorage.run(newStacks, async () => {
    return await callback()
  })
}

if (trackedStackGlobal.withTrackedStack) {
  console.warn("globalThis.withTrackedStack was already defined")
} else {
  trackedStackGlobal.withTrackedStack = {addTrackedStackToError, withTrackedStack}
}

export {addTrackedStackToError, withTrackedStack}
