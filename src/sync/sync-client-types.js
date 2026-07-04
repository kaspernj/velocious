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
 * @property {"upsert" | ((args: {operation: "create" | "update" | "destroy", record: ?}) => string)} [syncType] - Maps a mutation operation to a sync type. The "upsert" flag queues creates and updates as "update" rows (the server upserts by resource id) and destroys as "delete". Defaults to the operation name with destroy mapped to "delete".
 * @property {(args: {operation: "create" | "update" | "destroy", record: ?}) => Record<string, ?>} [trackedData] - Custom queued-payload builder for tracked mutations.
 * @property {boolean | {operations: Array<"create" | "update" | "destroy">}} [track] - Enables automatic mutation tracking through model lifecycle callbacks.
 */

/**
 * Model-level client sync declaration read from `static sync` by
 * `SyncClient.fromConfiguration(...)`. `true` opts the model in with all
 * defaults; an object customizes the derived resource config.
 * @typedef {object} ModelSyncDeclarationConfig
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["afterApply"]} [afterApply] - Post-apply hook.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} [attributes] - Pull-apply attribute mapper. Required for resources that receive pulled changes.
 * @property {string[]} [booleanAttributes] - Extra boolean attributes merged with the boolean columns derived from column types.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["findRecord"]} [findRecord] - Custom pull-apply record resolver.
 * @property {import("./sync-api-client-types.js").SyncResourceConfig["findRecordForDelete"]} [findRecordForDelete] - Custom pull-apply delete resolver.
 * @property {string[]} [localOnlyAttributes] - Extra local-only attributes merged with the derived primary key, createdAt/updatedAt, and sync bookkeeping attributes.
 * @property {"upsert" | ((args: {operation: "create" | "update" | "destroy", record: ?}) => string)} [syncType] - Sync type flag or mapper (see SyncClientResourceConfig).
 * @property {boolean | Array<"create" | "update" | "destroy"> | {operations: Array<"create" | "update" | "destroy">}} [track] - Enables automatic mutation tracking; an array is shorthand for {operations}.
 * @property {(args: {operation: "create" | "update" | "destroy", record: ?}) => Record<string, ?>} [trackedData] - Custom queued-payload builder for tracked mutations.
 */

/** @typedef {boolean | ModelSyncDeclarationConfig} ModelSyncDeclaration */

/**
 * Options for building a sync client. Everything else — resources, transport
 * POSTers, auth, connectivity, batch size — is derived from the configuration's
 * registered models (`static sync`) and its `sync.client` block.
 * @typedef {object} SyncClientOptions
 * @property {import("../configuration.js").default} [configuration] - Configuration owning the registered models, the `sync.client` block, and the scope-store database. Defaults to the current configuration.
 * @property {(args: {scope: SerializedSyncScope}) => string | null | Promise<string | null>} [legacyCursor] - Seeds a newly declared scope's cursor (e.g. from a pre-scope cursor store) so devices don't re-pull everything.
 * @property {import("./sync-scope-store.js").default} [scopeStore] - Scope store override (tests).
 * @property {?} [syncModel] - Pending-sync model override. Defaults to the registered "Sync" model.
 */

/**
 * Internal derived sync client configuration built by the SyncClient
 * constructor — not an app-facing API.
 * @typedef {object} SyncClientConfig
 * @property {() => string | Promise<string>} authenticationToken - Resolves the auth token sent with sync requests.
 * @property {number} [batchSize] - Max syncs per request.
 * @property {import("../configuration.js").default} configuration - Configuration owning the scope-store database.
 * @property {() => boolean | Promise<boolean>} [isOnline] - Connectivity gate for pulls and replays. Defaults to always online.
 * @property {(args: {scope: SerializedSyncScope}) => string | null | Promise<string | null>} [legacyCursor] - Seeds a newly declared scope's cursor (e.g. from a pre-scope cursor store) so devices don't re-pull everything.
 * @property {(error: Error) => void} [onError] - Reports background replay/pull failures. Defaults to rethrowing.
 * @property {(payload: import("./sync-api-client-types.js").SyncChangesRequest & {scope: SerializedSyncScope}) => Promise<import("./sync-api-client-types.js").SyncChangesResponse>} postChanges - Posts one changes request.
 * @property {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<import("./sync-api-client-types.js").SyncReplayResponse>} postReplay - Posts one replay request.
 * @property {Record<string, SyncClientResourceConfig>} resources - Derived resource policies keyed by resource/model name.
 * @property {?} syncModel - Local pending-sync model class.
 */

export {}
