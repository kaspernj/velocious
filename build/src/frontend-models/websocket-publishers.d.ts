export type FrontendModelPublisherResource = {
    primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition;
};
export type FrontendModelWebsocketRecord = import("../database/record/index.js").default & {
    __frontendModelWebsocketAction?: "create" | "update";
    __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>;
};
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