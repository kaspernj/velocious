// @ts-check

/**
 * @param {object} args - Dispatch arguments.
 * @param {string} args.channel - Channel name.
 * @param {string | undefined} args.createdAt - Event creation timestamp.
 * @param {string | undefined} args.eventId - Event identifier.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../logger.js").default} args.logger - Logger for isolated subscriber failures.
 * @param {?} args.payload - Broadcast payload.
 * @returns {Promise<void>} Resolves after subscribers have been attempted.
 */
export default async function dispatchChannelSubscribers({channel, configuration, createdAt, eventId, logger, payload}) {
  try {
    await configuration.getWebsocketChannelSubscribers().dispatch({channel, createdAt, eventId, payload})
  } catch (error) {
    logger.error(() => [`Channel subscriber dispatch failed for ${channel}`, error])

    const errorPayload = {
      context: {channel, createdAt, eventId, source: "websocket-channel-subscribers"},
      error
    }

    configuration.getErrorEvents().emit("framework-error", errorPayload)
    configuration.getErrorEvents().emit("all-error", {...errorPayload, errorType: "framework-error"})
  }
}
