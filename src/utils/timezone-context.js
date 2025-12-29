// @ts-check

import {AsyncLocalStorage} from "./async-local-storage.js"

/** @typedef {{offsetMinutes: number}} TimezoneStore */

/** @type {import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined} */
let asyncLocalStorage

if (AsyncLocalStorage) {
  asyncLocalStorage = new AsyncLocalStorage()
}

/**
 * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
 * @param {() => Promise<any>} callback - Callback to run.
 * @returns {Promise<any>} - Result of the callback.
 */
export async function runWithTimezoneOffset(offsetMinutes, callback) {
  if (asyncLocalStorage) {
    return await asyncLocalStorage.run({offsetMinutes}, callback)
  }

  return await callback()
}

/**
 * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
 * @returns {void} - No return value.
 */
export function setTimezoneOffset(offsetMinutes) {
  if (!asyncLocalStorage) return

  const store = asyncLocalStorage.getStore()

  if (store) {
    store.offsetMinutes = offsetMinutes
  } else {
    asyncLocalStorage.enterWith({offsetMinutes})
  }
}

/**
 * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
 * @returns {number} - Offset in minutes.
 */
export function getTimezoneOffsetMinutes(configuration) {
  if (asyncLocalStorage) {
    const store = asyncLocalStorage.getStore()

    if (store && typeof store.offsetMinutes === "number") {
      return store.offsetMinutes
    }
  }

  if (configuration && typeof configuration.getTimezoneOffsetMinutes === "function") {
    const configOffset = configuration.getTimezoneOffsetMinutes()

    if (typeof configOffset === "number") return configOffset
  }

  return new Date().getTimezoneOffset()
}
