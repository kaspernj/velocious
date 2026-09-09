// @ts-check

import {bearerToken, constantTimeEqual} from "../../utils/bearer-token.js"

/**
 * Runs is loopback.
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
 * @param {import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default} args.request - Request object.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../authorization/ability.js").default | undefined} args.ability - Current ability.
 * @param {string | null} [args.token] - Explicit websocket subscription token.
 * @returns {Promise<boolean>} - Whether the request is authorized.
 */
export async function authorizeJobsRequest({ability, configuration, options, request, token: explicitToken}) {
  const accessTokens = Array.isArray(options.accessTokens)
    ? options.accessTokens.filter((token) => typeof token === "string" && token.length > 0)
    : []
  const authorize = typeof options.authorize === "function" ? options.authorize : null
  const token = explicitToken ?? bearerToken(request)

  if (accessTokens.length > 0 && token) {
    for (const accessToken of accessTokens) {
      if (constantTimeEqual(token, accessToken)) return true
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
