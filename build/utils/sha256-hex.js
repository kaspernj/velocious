// @ts-check

import sha256BytesHex from "./sha256-bytes-hex.js"

/**
 * Computes SHA-256 without importing Node-only crypto modules, keeping this
 * module safe for Expo/browser bundles.
 * @param {string} message - UTF-8 message.
 * @returns {string} Hex digest.
 */
export default function sha256Hex(message) {
  return sha256BytesHex(new TextEncoder().encode(message))
}
