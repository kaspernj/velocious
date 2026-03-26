// @ts-check

import {AsyncLocalStorage} from "node:async_hooks"

/** @type {import("node:async_hooks").AsyncLocalStorage<Array<string[]>> | undefined} */
let asyncLocalStorage

/** @type {{withTrackedStack?: {addTrackedStackToError: (error: Error) => void, withTrackedStack: (arg1: string | (() => Promise<unknown>), arg2?: (() => Promise<unknown>) | Error) => Promise<unknown>}}} */
const trackedStackGlobal = /** @type {any} */ (globalThis)

if (AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage()
}

/** @param {Error} error - Error to annotate with a tracked stack. */
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
 *
 * @param {(() => Promise<unknown>) | string} arg1 - Arg1.
 * @param {(() => Promise<unknown>) | Error} [arg2] - Arg2.
 * @returns {Promise<unknown>} - Resolves with the callback result.
 */
async function withTrackedStack(arg1, arg2) {
  /** @type {() => Promise<unknown>} */
  let callback

  /** @type {string} */
  let stack

  if (typeof arg2 == "function" && typeof arg1 == "string") {
    callback = /** @type {() => Promise<unknown>} */ (arg2)
    stack = arg1
  } else {
    callback = /** @type {() => Promise<unknown>} */ (arg1)
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
