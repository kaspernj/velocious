// @ts-check

import proxyaddr from "proxy-addr"

/**
 * Trusted proxy cache.
  @type {WeakMap<import("../configuration.js").default, {source: string | string[] | undefined, trust: ((address: string, index: number) => boolean) | undefined}>} */
const trustedProxyCache = new WeakMap()

/**
 * Runs trusted proxy checker.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {((address: string, index: number) => boolean) | undefined} - Compiled trusted proxy checker.
 */
function trustedProxyChecker(configuration) {
  const trustedProxies = configuration.getTrustedProxies()
  const cached = trustedProxyCache.get(configuration)

  if (cached && cached.source === trustedProxies) return cached.trust

  if (!trustedProxies || (Array.isArray(trustedProxies) && trustedProxies.length === 0)) {
    trustedProxyCache.set(configuration, {source: trustedProxies, trust: undefined})
    return undefined
  }

  const trust = proxyaddr.compile(trustedProxies)

  trustedProxyCache.set(configuration, {source: trustedProxies, trust})

  return trust
}

/**
 * Runs node style headers.
 * @param {Record<string, string | string[]>} headers - Request headers.
 * @returns {Record<string, string | string[]>} - Headers with lowercase names.
 */
function nodeStyleHeaders(headers) {
  /**
   * Result.
    @type {Record<string, string | string[]>} */
  const result = {}

  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value
  }

  return result
}

/**
 * Runs resolve remote address.
 * @param {object} args - Options object.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, string | string[]>} args.headers - Request headers.
 * @param {string | undefined} args.socketRemoteAddress - Socket peer address.
 * @returns {string | undefined} - Resolved client remote address.
 */
export default function resolveRemoteAddress({configuration, headers, socketRemoteAddress}) {
  if (!socketRemoteAddress) return socketRemoteAddress

  const trust = trustedProxyChecker(configuration)

  if (!trust) return socketRemoteAddress

  const proxyRequest = /**
                        * Narrows the runtime value to the documented type.
                         @type {Parameters<typeof proxyaddr>[0]} */ (/**
                                                                      * Narrows the runtime value to the documented type.
                                                                       @type {?} */ ({
    connection: {remoteAddress: socketRemoteAddress},
    headers: nodeStyleHeaders(headers),
    socket: {remoteAddress: socketRemoteAddress}
  }))

  return proxyaddr(proxyRequest, trust)
}
