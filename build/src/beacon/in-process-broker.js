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
/**
 * Defines this typedef.
 * @typedef {{_receiveBroadcast: (message: import("./types.js").BeaconBroadcastMessage) => void}} InProcessPeer */
/**
 * Peers.
 * @type {Set<InProcessPeer>} */
const peers = new Set();
/**
 * Registers a peer with the broker. Returns an unregister function.
 * @param {InProcessPeer} peer - Peer instance.
 * @returns {() => void} - Unregister function.
 */
export function registerInProcessPeer(peer) {
    peers.add(peer);
    return () => {
        peers.delete(peer);
    };
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
                peer._receiveBroadcast(message);
            }
            catch (error) {
                // Mirrors the daemon's per-peer fan-out resilience: a thrown
                // handler on one peer must not prevent delivery to others. The
                // caller's framework-error path covers higher-level reporting.
                console.error("In-process Beacon peer threw during broadcast delivery:", error);
            }
        });
    }
}
/**
 * Runs the getInProcessPeerCount helper.
 * @returns {number} - Current peer count. Exposed for diagnostics and tests.
 */
export function getInProcessPeerCount() {
    return peers.size;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW4tcHJvY2Vzcy1icm9rZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmVhY29uL2luLXByb2Nlc3MtYnJva2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUVIOztrSEFFa0g7QUFFbEg7O2dDQUVnQztBQUNoQyxNQUFNLEtBQUssR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0FBRXZCOzs7O0dBSUc7QUFDSCxNQUFNLFVBQVUscUJBQXFCLENBQUMsSUFBSTtJQUN4QyxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBRWYsT0FBTyxHQUFHLEVBQUU7UUFDVixLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3BCLENBQUMsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFNLFVBQVUsdUJBQXVCLENBQUMsT0FBTztJQUM3QyxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3pCLGNBQWMsQ0FBQyxHQUFHLEVBQUU7WUFDbEIsSUFBSSxDQUFDO2dCQUNILElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUNqQyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZiw2REFBNkQ7Z0JBQzdELCtEQUErRDtnQkFDL0QsK0RBQStEO2dCQUMvRCxPQUFPLENBQUMsS0FBSyxDQUFDLHlEQUF5RCxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ2pGLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7QUFDSCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsTUFBTSxVQUFVLHFCQUFxQjtJQUNuQyxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUE7QUFDbkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIE1vZHVsZS1sZXZlbCBicm9rZXIgc2luZ2xldG9uIGZvciBpbi1wcm9jZXNzIEJlYWNvbiBtb2RlLlxuICpcbiAqIEV2ZXJ5IGBJblByb2Nlc3NCZWFjb25DbGllbnRgIHJlZ2lzdGVycyBpdHNlbGYgaGVyZSBvbiBgY29ubmVjdCgpYCBhbmRcbiAqIHVucmVnaXN0ZXJzIG9uIGBjbG9zZSgpYC4gYHB1Ymxpc2gobWVzc2FnZSlgIHNjaGVkdWxlcyBhIG1pY3JvdGFza1xuICogZmFuLW91dCB0byBldmVyeSByZWdpc3RlcmVkIHBlZXIncyBgX3JlY2VpdmVCcm9hZGNhc3QobWVzc2FnZSlgLiBUaGVcbiAqIG1pY3JvdGFzayBib3VuZGFyeSBrZWVwcyBcInB1Ymxpc2gsIHRoZW4gcmVjZWl2ZVwiIG9yZGVyaW5nIHNhZmUgZXZlblxuICogd2hlbiB0aGUgcHVibGlzaGVyIGFuZCBhIHN1YnNjcmliZXIgYXJlIHRoZSBzYW1lIGNsaWVudCDigJQgd2l0aG91dCBpdCxcbiAqIGEgc3luY2hyb25vdXMgZmFuLW91dCBjb3VsZCByZS1lbnRlciB0aGUgY2FsbGVyIG1pZC1wdWJsaXNoIGlmIGFcbiAqIGJyb2FkY2FzdCBoYW5kbGVyIHN5bmNocm9ub3VzbHkgcHVibGlzaGVkIGFnYWluLlxuICpcbiAqIERlc2lnbmVkIGZvciB0d28gc2NlbmFyaW9zOlxuICogICAxLiBUZXN0cyB3aXRoIG11bHRpcGxlIGBDb25maWd1cmF0aW9uYCBpbnN0YW5jZXMgaW4gb25lIHByb2Nlc3NcbiAqICAgICAgKG5vIFRDUCBzb2NrZXQgc2V0dXAsIGRldGVybWluaXN0aWMgb3JkZXJpbmcgdmlhIG1pY3JvdGFza3MpLlxuICogICAyLiBTaW5nbGUtcHJvY2VzcyBwcm9kdWN0aW9uIGRlcGxveW1lbnRzIHRoYXQgd2FudCB0aGUgc2FtZVxuICogICAgICBgYnJvYWRjYXN0VG9DaGFubmVsYCBlcmdvbm9taWNzIHdpdGhvdXQgcnVubmluZyB0aGUgZGFlbW9uLlxuICovXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e19yZWNlaXZlQnJvYWRjYXN0OiAobWVzc2FnZTogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlKSA9PiB2b2lkfX0gSW5Qcm9jZXNzUGVlciAqL1xuXG4vKipcbiAqIFBlZXJzLlxuICogQHR5cGUge1NldDxJblByb2Nlc3NQZWVyPn0gKi9cbmNvbnN0IHBlZXJzID0gbmV3IFNldCgpXG5cbi8qKlxuICogUmVnaXN0ZXJzIGEgcGVlciB3aXRoIHRoZSBicm9rZXIuIFJldHVybnMgYW4gdW5yZWdpc3RlciBmdW5jdGlvbi5cbiAqIEBwYXJhbSB7SW5Qcm9jZXNzUGVlcn0gcGVlciAtIFBlZXIgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBVbnJlZ2lzdGVyIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJJblByb2Nlc3NQZWVyKHBlZXIpIHtcbiAgcGVlcnMuYWRkKHBlZXIpXG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBwZWVycy5kZWxldGUocGVlcilcbiAgfVxufVxuXG4vKipcbiAqIFNjaGVkdWxlcyBhIGZhbi1vdXQgb2YgdGhlIGdpdmVuIG1lc3NhZ2UgdG8gZXZlcnkgcmVnaXN0ZXJlZCBwZWVyLlxuICogRWFjaCBkZWxpdmVyeSBpcyBpdHMgb3duIG1pY3JvdGFzayBzbyBoYW5kbGVycyBydW4gaW4gdGhlIG9yZGVyIHBlZXJzXG4gKiByZWdpc3RlcmVkLCBidXQgbmV2ZXIgc3luY2hyb25vdXNseSBpbnNpZGUgdGhlIHB1Ymxpc2ggY2FsbC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlfSBtZXNzYWdlIC0gQnJvYWRjYXN0IG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHB1Ymxpc2hUb0luUHJvY2Vzc1BlZXJzKG1lc3NhZ2UpIHtcbiAgZm9yIChjb25zdCBwZWVyIG9mIHBlZXJzKSB7XG4gICAgcXVldWVNaWNyb3Rhc2soKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcGVlci5fcmVjZWl2ZUJyb2FkY2FzdChtZXNzYWdlKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gTWlycm9ycyB0aGUgZGFlbW9uJ3MgcGVyLXBlZXIgZmFuLW91dCByZXNpbGllbmNlOiBhIHRocm93blxuICAgICAgICAvLyBoYW5kbGVyIG9uIG9uZSBwZWVyIG11c3Qgbm90IHByZXZlbnQgZGVsaXZlcnkgdG8gb3RoZXJzLiBUaGVcbiAgICAgICAgLy8gY2FsbGVyJ3MgZnJhbWV3b3JrLWVycm9yIHBhdGggY292ZXJzIGhpZ2hlci1sZXZlbCByZXBvcnRpbmcuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJJbi1wcm9jZXNzIEJlYWNvbiBwZWVyIHRocmV3IGR1cmluZyBicm9hZGNhc3QgZGVsaXZlcnk6XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBnZXRJblByb2Nlc3NQZWVyQ291bnQgaGVscGVyLlxuICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IHBlZXIgY291bnQuIEV4cG9zZWQgZm9yIGRpYWdub3N0aWNzIGFuZCB0ZXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEluUHJvY2Vzc1BlZXJDb3VudCgpIHtcbiAgcmV0dXJuIHBlZXJzLnNpemVcbn1cbiJdfQ==