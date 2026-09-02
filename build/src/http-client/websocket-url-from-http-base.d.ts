/**
 * Builds the Velocious websocket URL for a backend HTTP base URL: swaps the
 * http(s) scheme for ws(s) and appends the framework's `/websocket` mount path.
 * @param {string} httpBase - Backend HTTP base URL (for example `https://ticketserver.example.com`).
 * @returns {string} Websocket URL.
 */
export declare function websocketUrlFromHttpBase(httpBase: string): string;
//# sourceMappingURL=websocket-url-from-http-base.d.ts.map