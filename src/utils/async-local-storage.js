// @ts-check

import envSense from "env-sense/build/use-env-sense.js"

/** @type {typeof import("node:async_hooks").AsyncLocalStorage | null | undefined} */
let AsyncLocalStorage

const {isServer: isNode} = envSense()

if (isNode) {
  const {getAsyncLocalStorage} = await import("../environment-handlers/node.js")
  AsyncLocalStorage = getAsyncLocalStorage()
} else {
  const {getAsyncLocalStorage} = await import("../environment-handlers/browser.js")
  AsyncLocalStorage = getAsyncLocalStorage()
}

export {AsyncLocalStorage}
