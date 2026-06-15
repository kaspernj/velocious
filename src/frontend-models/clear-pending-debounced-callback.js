// @ts-check

/**
 * Runs clear pending debounced callback.
 * @param {?} callback - Potentially debounced callback.
 * @returns {void}
 */
export default function clearPendingDebouncedCallback(callback) {
  const callbackWithClear = /**
                             * Narrows the runtime value to the documented type.
                             * @type {{clear?: ?}} */ (callback)

  if (typeof callbackWithClear.clear === "function") {
    callbackWithClear.clear()
  }
}
