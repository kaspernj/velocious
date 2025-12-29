// @ts-check

import envSense from "env-sense/build/use-env-sense.js"

/** @type {typeof import("node:async_hooks").AsyncLocalStorage | undefined} */
let AsyncLocalStorage

const {isServer: isNode} = envSense()

if (isNode) {
  // Hack: use dynamic import + fallback specifier to avoid bundler/static import issues in non-Node targets.
  const asyncImport = new Function("specifier", "return import(specifier)")

  try {
    const mod = await asyncImport("node:async_hooks")
    AsyncLocalStorage = mod.AsyncLocalStorage
  } catch {
    try {
      const mod = await asyncImport("async_hooks")
      AsyncLocalStorage = mod.AsyncLocalStorage
    } catch {
      // Not supported.
    }
  }
}

export {AsyncLocalStorage}
