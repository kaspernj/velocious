/**
 * Runs dispatch channel subscribers.
 * @param {object} args - Dispatch arguments.
 * @param {string} args.channel - Channel name.
 * @param {string | undefined} args.createdAt - Event creation timestamp.
 * @param {string | undefined} args.eventId - Event identifier.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../logger.js").default} args.logger - Logger for isolated subscriber failures.
 * @param {ReturnType<typeof JSON.parse>} args.payload - Broadcast payload.
 * @returns {Promise<void>} Resolves after subscribers have been attempted.
 */
export default function dispatchChannelSubscribers({ channel, configuration, createdAt, eventId, logger, payload }: {
    channel: string;
    createdAt: string | undefined;
    eventId: string | undefined;
    configuration: import("../../configuration.js").default;
    logger: import("../../logger.js").default;
    payload: ReturnType<typeof JSON.parse>;
}): Promise<void>;
//# sourceMappingURL=channel-subscriber-dispatch.d.ts.map