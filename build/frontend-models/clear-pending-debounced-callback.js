// @ts-check

/**
 * Runs clear pending debounced callback.
 * @param {ReturnType<typeof JSON.parse>} callback - Potentially debounced callback.
 * @returns {void}
 */
export default function clearPendingDebouncedCallback(callback) {
  const callbackWithClear = /** @type {{clear?: ReturnType<typeof JSON.parse>}} */ (callback)

  if (typeof callbackWithClear.clear === "function") {
    callbackWithClear.clear()
  }
}
