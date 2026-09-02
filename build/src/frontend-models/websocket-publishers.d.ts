/** Shared channel name for all frontend-model lifecycle subscriptions. */
export declare const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models";
/**
 * Runs the frontendModelBroadcastChannelName helper.
 * @param {string} modelName - Model class name.
 * @returns {string} - Broadcast channel name (legacy, retained for migration compatibility).
 */
export declare function frontendModelBroadcastChannelName(modelName: string): string;
/**
 * Runs the ensureFrontendModelWebsocketPublishersRegistered helper.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>}
 */
export declare function ensureFrontendModelWebsocketPublishersRegistered(configuration: import("../configuration.js").default): Promise<void>;
//# sourceMappingURL=websocket-publishers.d.ts.map