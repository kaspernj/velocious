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
 * @typedef {{type: "broadcast", channel: string, broadcastParams: Record<string, any>, body: any, originPeerId?: string}} BeaconBroadcastMessage
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
 * @typedef {BeaconHelloMessage | BeaconBroadcastMessage} BeaconSocketMessage
 */

export const nothing = {}
