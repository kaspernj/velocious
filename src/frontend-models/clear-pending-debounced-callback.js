// @ts-check

/**
 * @param {unknown} callback - Potentially debounced callback.
 * @returns {void}
 */
export default function clearPendingDebouncedCallback(callback) {
  const callbackWithClear = /** @type {{clear?: unknown}} */ (callback)

  if (typeof callbackWithClear.clear === "function") {
    callbackWithClear.clear()
  }
}
