// @ts-check

/**
 * Module-level broker singleton for in-process Beacon mode.
 *
 * Every `InProcessBeaconClient` registers itself here on `connect()` and
 * unregisters on `close()`. `publish(message)` schedules a microtask
 * fan-out to every registered peer's `_receiveBroadcast(message)`. The
 * microtask boundary keeps "publish, then receive" ordering safe even
 * when the publisher and a subscriber are the same client — without it,
 * a synchronous fan-out could re-enter the caller mid-publish if a
 * broadcast handler synchronously published again.
 *
 * Designed for two scenarios:
 *   1. Tests with multiple `Configuration` instances in one process
 *      (no TCP socket setup, deterministic ordering via microtasks).
 *   2. Single-process production deployments that want the same
 *      `broadcastToChannel` ergonomics without running the daemon.
 */

/** @typedef {{_receiveBroadcast: (message: import("./types.js").BeaconBroadcastMessage) => void}} InProcessPeer */

/** @type {Set<InProcessPeer>} */
const peers = new Set()

/**
 * Registers a peer with the broker. Returns an unregister function.
 * @param {InProcessPeer} peer - Peer instance.
 * @returns {() => void} - Unregister function.
 */
export function registerInProcessPeer(peer) {
  peers.add(peer)

  return () => {
    peers.delete(peer)
  }
}

/**
 * Schedules a fan-out of the given message to every registered peer.
 * Each delivery is its own microtask so handlers run in the order peers
 * registered, but never synchronously inside the publish call.
 * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
 * @returns {void}
 */
export function publishToInProcessPeers(message) {
  for (const peer of peers) {
    queueMicrotask(() => {
      try {
        peer._receiveBroadcast(message)
      } catch (error) {
        // Mirrors the daemon's per-peer fan-out resilience: a thrown
        // handler on one peer must not prevent delivery to others. The
        // caller's framework-error path covers higher-level reporting.
        console.error("In-process Beacon peer threw during broadcast delivery:", error)
      }
    })
  }
}

/**
 * @returns {number} - Current peer count. Exposed for diagnostics and tests.
 */
export function getInProcessPeerCount() {
  return peers.size
}
