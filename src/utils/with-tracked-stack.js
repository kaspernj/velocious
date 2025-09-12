import {AsyncLocalStorage} from "async_hooks"

let asyncLocalStorage

if (AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage()
}

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

async function withTrackedStack(arg1, arg2) {
  let callback, stack

  if (arg2) {
    callback = arg2
    stack = arg1
  } else {
    callback = arg1
    stack = Error().stack
  }

  // Not supported
  if (!asyncLocalStorage) return await callback()

  const parentStacks = asyncLocalStorage.getStore() || []
  const additionalStackLines = ["    [WITH TRACKED STACK]"]
  const currentStackLines = stack.split("\n")

  for (let i = currentStackLines.length; i >= 0; i--) {
    const stackLine = currentStackLines[i]

    if (stackLine == "    [WITH TRACKED STACK]") {
      break
    } else {
      additionalStackLines.unshift(stackLine)
    }
  }

  const newStacks = [additionalStackLines, ...parentStacks]

  await asyncLocalStorage.run(newStacks, async () => {
    return await callback()
  })
}

export {addTrackedStackToError, withTrackedStack}
