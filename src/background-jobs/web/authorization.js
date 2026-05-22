// @ts-check

import crypto from "node:crypto"

/**
 * Constant-time comparison so token checks don't leak length/contents through
 * timing. Returns false for differing lengths before the timing-safe compare.
 * @param {string} a - First value.
 * @param {string} b - Second value.
 * @returns {boolean} - Whether the values are equal.
 */
function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a))
  const bufferB = Buffer.from(String(b))

  if (bufferA.length !== bufferB.length) return false

  return crypto.timingSafeEqual(bufferA, bufferB)
}

/**
 * @param {import("../../http-server/client/request.js").default} request - Request object.
 * @returns {string | null} - Bearer token from the Authorization header, if any.
 */
function bearerToken(request) {
  const header = request.header("authorization")

  if (typeof header !== "string") return null

  const match = header.match(/^Bearer\s+(.+)$/i)

  return match ? match[1].trim() : null
}

/**
 * @param {string | undefined} remoteAddress - Remote address.
 * @returns {boolean} - Whether the address is loopback.
 */
function isLoopback(remoteAddress) {
  if (!remoteAddress) return false

  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1" ||
    remoteAddress.startsWith("127.")
  )
}

/**
 * Decides whether a jobs-dashboard request is authorized. Order of precedence:
 * a matching bearer token, then the host-supplied `authorize` callback. When
 * neither tokens nor an authorize callback are configured, access falls back to
 * loopback-only so a freshly mounted dashboard is reachable on the same host
 * during development without being exposed to the network.
 * @param {object} args - Options.
 * @param {import("./registry.js").JobsMountOptions} args.options - Mount options.
 * @param {import("../../http-server/client/request.js").default} args.request - Request object.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../authorization/ability.js").default | undefined} args.ability - Current ability.
 * @returns {Promise<boolean>} - Whether the request is authorized.
 */
export async function authorizeJobsRequest({ability, configuration, options, request}) {
  const accessTokens = Array.isArray(options.accessTokens)
    ? options.accessTokens.filter((token) => typeof token === "string" && token.length > 0)
    : []
  const authorize = typeof options.authorize === "function" ? options.authorize : null
  const token = bearerToken(request)

  if (accessTokens.length > 0 && token) {
    for (const accessToken of accessTokens) {
      if (safeEqual(token, accessToken)) return true
    }
  }

  if (authorize) {
    const result = await authorize({ability, configuration, request, token})

    if (result === true) return true
  }

  if (accessTokens.length === 0 && !authorize) {
    return isLoopback(request.remoteAddress())
  }

  return false
}
