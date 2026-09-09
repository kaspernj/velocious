// @ts-check
/**
 * Wire-message typedefs for the Beacon broadcast bus.
 *
 * Beacon is Velocious's cross-process pub/sub bus. The daemon
 * (`velocious beacon`) accepts JsonSocket connections from any number
 * of peer processes (HTTP server, background-jobs main, background-jobs
 * worker, etc.) and fans every `broadcast` message out to every
 * connected peer — including the sender, so each process can deliver
 * to its local websocket subscribers via a single code path.
 */
/**
 * @typedef {"client"} BeaconSocketRole
 *
 * Beacon currently only has one role. The role field is kept on the
 * `hello` handshake so future roles (e.g. an admin/inspector role) can
 * be added without bumping the wire format.
 */
/**
 * @typedef {{type: "hello", role: BeaconSocketRole, peerId: string, peerType?: string}} BeaconHelloMessage
 *
 * `peerId` uniquely identifies the connecting process for echo
 * suppression and logging. `peerType` is an optional human-readable
 * label such as `"server"`, `"background-jobs-worker"` — informational
 * only.
 */
/**
 * @typedef {{type: "hello-ack", peerId: string}} BeaconHelloAckMessage
 *
 * Sent by the daemon after it has registered the peer. Clients can use
 * this as a deterministic readiness boundary before publishing events
 * that must not fall back to local-only delivery.
 */
/**
 * @typedef {{type: "broadcast", channel: string, broadcastParams: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>, originPeerId?: string}} BeaconBroadcastMessage
 *
 * `channel`, `broadcastParams`, and `body` mirror the
 * `configuration.broadcastToChannel(channel, broadcastParams, body)`
 * arguments. `originPeerId` is stamped by the publishing client and
 * preserved through the daemon so receivers can choose to skip echoes
 * of their own broadcasts (the default Configuration integration does
 * not skip — synapse-style fan-out always returns to sender so every
 * peer follows the same delivery path).
 */
/**
 * @typedef {BeaconHelloMessage | BeaconHelloAckMessage | BeaconBroadcastMessage} BeaconSocketMessage
 */
export const nothing = {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmVhY29uL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7Ozs7O0dBU0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7Ozs7R0FVRztBQUVIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdpcmUtbWVzc2FnZSB0eXBlZGVmcyBmb3IgdGhlIEJlYWNvbiBicm9hZGNhc3QgYnVzLlxuICpcbiAqIEJlYWNvbiBpcyBWZWxvY2lvdXMncyBjcm9zcy1wcm9jZXNzIHB1Yi9zdWIgYnVzLiBUaGUgZGFlbW9uXG4gKiAoYHZlbG9jaW91cyBiZWFjb25gKSBhY2NlcHRzIEpzb25Tb2NrZXQgY29ubmVjdGlvbnMgZnJvbSBhbnkgbnVtYmVyXG4gKiBvZiBwZWVyIHByb2Nlc3NlcyAoSFRUUCBzZXJ2ZXIsIGJhY2tncm91bmQtam9icyBtYWluLCBiYWNrZ3JvdW5kLWpvYnNcbiAqIHdvcmtlciwgZXRjLikgYW5kIGZhbnMgZXZlcnkgYGJyb2FkY2FzdGAgbWVzc2FnZSBvdXQgdG8gZXZlcnlcbiAqIGNvbm5lY3RlZCBwZWVyIOKAlCBpbmNsdWRpbmcgdGhlIHNlbmRlciwgc28gZWFjaCBwcm9jZXNzIGNhbiBkZWxpdmVyXG4gKiB0byBpdHMgbG9jYWwgd2Vic29ja2V0IHN1YnNjcmliZXJzIHZpYSBhIHNpbmdsZSBjb2RlIHBhdGguXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7XCJjbGllbnRcIn0gQmVhY29uU29ja2V0Um9sZVxuICpcbiAqIEJlYWNvbiBjdXJyZW50bHkgb25seSBoYXMgb25lIHJvbGUuIFRoZSByb2xlIGZpZWxkIGlzIGtlcHQgb24gdGhlXG4gKiBgaGVsbG9gIGhhbmRzaGFrZSBzbyBmdXR1cmUgcm9sZXMgKGUuZy4gYW4gYWRtaW4vaW5zcGVjdG9yIHJvbGUpIGNhblxuICogYmUgYWRkZWQgd2l0aG91dCBidW1waW5nIHRoZSB3aXJlIGZvcm1hdC5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCZWFjb25Tb2NrZXRSb2xlLCBwZWVySWQ6IHN0cmluZywgcGVlclR5cGU/OiBzdHJpbmd9fSBCZWFjb25IZWxsb01lc3NhZ2VcbiAqXG4gKiBgcGVlcklkYCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSBjb25uZWN0aW5nIHByb2Nlc3MgZm9yIGVjaG9cbiAqIHN1cHByZXNzaW9uIGFuZCBsb2dnaW5nLiBgcGVlclR5cGVgIGlzIGFuIG9wdGlvbmFsIGh1bWFuLXJlYWRhYmxlXG4gKiBsYWJlbCBzdWNoIGFzIGBcInNlcnZlclwiYCwgYFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlclwiYCDigJQgaW5mb3JtYXRpb25hbFxuICogb25seS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsby1hY2tcIiwgcGVlcklkOiBzdHJpbmd9fSBCZWFjb25IZWxsb0Fja01lc3NhZ2VcbiAqXG4gKiBTZW50IGJ5IHRoZSBkYWVtb24gYWZ0ZXIgaXQgaGFzIHJlZ2lzdGVyZWQgdGhlIHBlZXIuIENsaWVudHMgY2FuIHVzZVxuICogdGhpcyBhcyBhIGRldGVybWluaXN0aWMgcmVhZGluZXNzIGJvdW5kYXJ5IGJlZm9yZSBwdWJsaXNoaW5nIGV2ZW50c1xuICogdGhhdCBtdXN0IG5vdCBmYWxsIGJhY2sgdG8gbG9jYWwtb25seSBkZWxpdmVyeS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJicm9hZGNhc3RcIiwgY2hhbm5lbDogc3RyaW5nLCBicm9hZGNhc3RQYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9yaWdpblBlZXJJZD86IHN0cmluZ319IEJlYWNvbkJyb2FkY2FzdE1lc3NhZ2VcbiAqXG4gKiBgY2hhbm5lbGAsIGBicm9hZGNhc3RQYXJhbXNgLCBhbmQgYGJvZHlgIG1pcnJvciB0aGVcbiAqIGBjb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChjaGFubmVsLCBicm9hZGNhc3RQYXJhbXMsIGJvZHkpYFxuICogYXJndW1lbnRzLiBgb3JpZ2luUGVlcklkYCBpcyBzdGFtcGVkIGJ5IHRoZSBwdWJsaXNoaW5nIGNsaWVudCBhbmRcbiAqIHByZXNlcnZlZCB0aHJvdWdoIHRoZSBkYWVtb24gc28gcmVjZWl2ZXJzIGNhbiBjaG9vc2UgdG8gc2tpcCBlY2hvZXNcbiAqIG9mIHRoZWlyIG93biBicm9hZGNhc3RzICh0aGUgZGVmYXVsdCBDb25maWd1cmF0aW9uIGludGVncmF0aW9uIGRvZXNcbiAqIG5vdCBza2lwIOKAlCBzeW5hcHNlLXN0eWxlIGZhbi1vdXQgYWx3YXlzIHJldHVybnMgdG8gc2VuZGVyIHNvIGV2ZXJ5XG4gKiBwZWVyIGZvbGxvd3MgdGhlIHNhbWUgZGVsaXZlcnkgcGF0aCkuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7QmVhY29uSGVsbG9NZXNzYWdlIHwgQmVhY29uSGVsbG9BY2tNZXNzYWdlIHwgQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gQmVhY29uU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==