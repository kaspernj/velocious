// @ts-check

/**
 * Builds the Velocious websocket URL for a backend HTTP base URL: swaps the
 * http(s) scheme for ws(s) and appends the framework's `/websocket` mount path.
 * @param {string} httpBase - Backend HTTP base URL (for example `https://ticketserver.example.com`).
 * @returns {string} Websocket URL.
 */
export function websocketUrlFromHttpBase(httpBase) {
  const wsScheme = httpBase.startsWith("https://") ? "wss" : "ws"
  const wsBase = httpBase.replace(/^https?/, wsScheme)

  return `${wsBase}/websocket`
}
