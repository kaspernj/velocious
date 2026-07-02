// @ts-check

/**
 * Client-declared sync scope serialized from a model query.
 * @typedef {object} SerializedSyncScope
 * @property {Record<string, ?>} conditions - Plain attribute conditions from the query.
 * @property {string} resourceType - Resource/model name the scope was declared for.
 */

/**
 * Declarative per-resource sync policy.
 * @typedef {object} SyncClientResourceConfig
 * @property {?} modelClass - Local model class for this resource.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} [attributes] - Pull-apply attribute mapper. Required for resources that receive pulled changes.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["findRecord"]} [findRecord] - Custom pull-apply record resolver.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["findRecordForDelete"]} [findRecordForDelete] - Custom pull-apply delete resolver.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["afterApply"]} [afterApply] - Post-apply hook.
 * @property {string[]} [booleanAttributes] - Attributes coerced through sync boolean parsing when queueing.
 * @property {string[]} [localOnlyAttributes] - Attributes stripped from queued payloads.
 * @property {(args: {operation: "create" | "update" | "destroy", record: ?}) => string} [syncType] - Maps a mutation operation to a sync type. Defaults to the operation name with destroy mapped to "delete".
 * @property {(args: {operation: "create" | "update" | "destroy", record: ?}) => Record<string, ?>} [trackedData] - Custom queued-payload builder for tracked mutations.
 * @property {boolean | {operations: Array<"create" | "update" | "destroy">}} [track] - Enables automatic mutation tracking through model lifecycle callbacks.
 */

/**
 * Declarative sync client configuration.
 * @typedef {object} SyncClientConfig
 * @property {() => string | Promise<string>} authenticationToken - Resolves the auth token sent with sync requests.
 * @property {number} [batchSize] - Max syncs per request.
 * @property {import("../configuration.js").default} [configuration] - Configuration owning the scope-store database. Defaults to the current configuration.
 * @property {() => boolean | Promise<boolean>} [isOnline] - Connectivity gate for pulls and replays. Defaults to always online.
 * @property {(args: {scope: SerializedSyncScope}) => string | null | Promise<string | null>} [legacyCursor] - Seeds a newly declared scope's cursor (e.g. from a pre-scope cursor store) so devices don't re-pull everything.
 * @property {(error: Error) => void} [onError] - Reports background replay/pull failures. Defaults to rethrowing.
 * @property {(payload: import("./sync-api-client-types.js").SyncChangesRequest & {scope: SerializedSyncScope}) => Promise<import("./sync-api-client-types.js").SyncChangesResponse>} postChanges - Posts one changes request.
 * @property {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<import("./sync-api-client-types.js").SyncReplayResponse>} postReplay - Posts one replay request.
 * @property {Record<string, SyncClientResourceConfig>} resources - Declarative resource policies keyed by resource/model name.
 * @property {import("./sync-scope-store.js").default} [scopeStore] - Scope store override.
 * @property {?} syncModel - Local pending-sync model class.
 */

export {}
