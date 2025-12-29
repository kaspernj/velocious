// @ts-check

import {AsyncLocalStorage} from "./async-local-storage.js"

/** @type {import("node:async_hooks").AsyncLocalStorage<Array<string[]>> | undefined} */
let asyncLocalStorage

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
 * @param {() => Promise<void> | string} arg1 - Arg1.
 * @param {() => Promise<void> | Error} [arg2] - Arg2.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function withTrackedStack(arg1, arg2) {
  /** @type {() => Promise<void>} */
  let callback

  /** @type {string} */
  let stack

  if (typeof arg2 == "function" && typeof arg1 == "string") {
    // @ts-expect-error
    callback = arg2
    stack = arg1
  } else {
    // @ts-expect-error
    callback = arg1
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

  await asyncLocalStorage.run(newStacks, async () => {
    await callback()
  })
}

if (globalThis.withTrackedStack) {
  console.warn("globalThis.withTrackedStack was already defined")
} else {
  globalThis.withTrackedStack = {addTrackedStackToError, withTrackedStack}
}

export {addTrackedStackToError, withTrackedStack}
