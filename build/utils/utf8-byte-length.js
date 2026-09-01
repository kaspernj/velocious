// @ts-check

/** @type {TextEncoder | undefined} Shared encoder instance. */
let sharedEncoder

/**
 * Returns the UTF-8 byte length of a string without Node's `Buffer`, so shared
 * driver code can bound query chunks in browser and React Native bundles too.
 * @param {string} value - String to measure.
 * @returns {number} - UTF-8 byte length.
 */
export function utf8ByteLength(value) {
  sharedEncoder ??= new TextEncoder()

  return sharedEncoder.encode(value).length
}
