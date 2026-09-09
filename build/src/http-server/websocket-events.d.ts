export default class VelociousHttpServerWebsocketEvents {
    parentPort: import("node:worker_threads").MessagePort | null;
    workerCount: number;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("node:worker_threads").MessagePort | null} args.parentPort - Parent port.
     * @param {number} args.workerCount - Worker count.
     */
    constructor({ parentPort, workerCount }: {
        parentPort: import("node:worker_threads").MessagePort | null;
        workerCount: number;
    });
    /**
     * Runs publish.
     * @param {string} channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
     * @returns {void} - No return value.
     */
    publish(channel: string, payload: ReturnType<typeof JSON.parse>): void;
    /**
     * Fan-out entry point for `configuration.broadcastToChannel` on V2
     * channels. The worker posts to the main process, which fans out to
     * every worker so subscribers on any worker receive the broadcast.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Filter params forwarded to `matches()`.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body delivered via `sendMessage()`.
     * @returns {void}
     */
    publishV2Broadcast({ channel, broadcastParams, body }: {
        channel: string;
        broadcastParams: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
    }): void;
}
//# sourceMappingURL=websocket-events.d.ts.map