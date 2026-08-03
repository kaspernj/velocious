// @ts-check

import crypto from "node:crypto"

/**
 * Constant-time comparison so token checks don't leak length/contents through
 * timing. Returns false for differing lengths before the timing-safe compare.
 * @param {string} a - First value.
 * @param {string} b - Second value.
 * @returns {boolean} - Whether the values are equal.
 */
export function constantTimeEqual(a, b) {
  const bufferA = Buffer.from(String(a))
  const bufferB = Buffer.from(String(b))

  if (bufferA.length !== bufferB.length) return false

  return crypto.timingSafeEqual(bufferA, bufferB)
}

/**
 * Extracts the bearer token from the Authorization header of a request.
 * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} request - Request object.
 * @returns {string | null} - Bearer token from the Authorization header, if any.
 */
export function bearerToken(request) {
  const header = request.header("authorization")

  if (typeof header !== "string") return null

  const match = header.match(/^Bearer\s+(.+)$/i)

  return match ? match[1].trim() : null
}
