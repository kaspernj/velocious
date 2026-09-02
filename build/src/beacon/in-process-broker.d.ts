export type InProcessPeer = {
    _receiveBroadcast: (message: import("./types.js").BeaconBroadcastMessage) => void;
};
/**
 * Registers a peer with the broker. Returns an unregister function.
 * @param {InProcessPeer} peer - Peer instance.
 * @returns {() => void} - Unregister function.
 */
export declare function registerInProcessPeer(peer: InProcessPeer): () => void;
/**
 * Schedules a fan-out of the given message to every registered peer.
 * Each delivery is its own microtask so handlers run in the order peers
 * registered, but never synchronously inside the publish call.
 * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
 * @returns {void}
 */
export declare function publishToInProcessPeers(message: import("./types.js").BeaconBroadcastMessage): void;
/**
 * Runs the getInProcessPeerCount helper.
 * @returns {number} - Current peer count. Exposed for diagnostics and tests.
 */
export declare function getInProcessPeerCount(): number;
//# sourceMappingURL=in-process-broker.d.ts.map