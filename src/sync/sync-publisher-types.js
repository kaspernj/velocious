// @ts-check

/**
 * Args resolved against a publish declaration's broadcasts after a published
 * server-side mutation commits.
 * @typedef {object} SyncPublishBroadcastArgs
 * @property {Record<string, ?>} data - Payload snapshotted through the declaration's `serialize(record)` at mutation time.
 * @property {"create" | "update" | "destroy"} operation - Mutation operation that published.
 * @property {?} record - Mutated server model record.
 * @property {string} resourceId - Published resource id.
 * @property {string} resourceType - Published resource type.
 * @property {?} syncRow - Upserted sync/change row.
 * @property {string} syncType - Published sync type ("update" for creates/updates, "delete" for destroys).
 */

/**
 * One declarative broadcast fanned out after a published server-side mutation
 * commits — same shape the replay service's injected broadcaster consumes.
 * @typedef {object} SyncPublishBroadcast
 * @property {string | ((args: SyncPublishBroadcastArgs) => string)} channel - Channel name or resolver.
 * @property {(args: SyncPublishBroadcastArgs) => Record<string, ?>} broadcastParams - Channel routing params.
 * @property {(args: SyncPublishBroadcastArgs) => ?} body - Broadcast body.
 * @property {(args: SyncPublishBroadcastArgs) => boolean} [when] - Optional gate; skipped when it returns false.
 */

/**
 * Server-side publish declaration on a model's `static sync`, consumed by
 * `SyncPublisher.fromConfiguration(...)`. Publishing is on for models
 * declaring it (server-side creates and updates write to the sync change
 * feed and broadcast automatically once their transaction commits);
 * `publish: false` opts a model out explicitly.
 * @typedef {object} SyncPublishDeclarationConfig
 * @property {(record: ?) => Record<string, ?> | Promise<Record<string, ?>>} serialize - Builds the published payload snapshot from the mutated record (snapshotted at mutation time).
 * @property {(record: ?) => string | number | null | Promise<string | number | null>} [eventId] - Resolves the event scope persisted to the sync row's event_id column.
 * @property {SyncPublishBroadcast[]} [broadcasts] - Declarative broadcasts fanned out after the sync row is upserted.
 * @property {Array<"create" | "update" | "destroy">} [operations] - Published operations. Defaults to creates and updates; destroys are opt-in because a server destroy is often cleanup rather than a synced delete.
 * @property {string} [resourceType] - Published resource type. Defaults to the model name.
 */

/** @typedef {false | SyncPublishDeclarationConfig} SyncPublishDeclaration */

/**
 * Options for building a sync publisher. Published resources are derived from
 * the configuration's registered models (`static sync` publish declarations).
 * @typedef {object} SyncPublisherOptions
 * @property {string} [actorForeignKeyColumn] - Sync model column linking rows to a device actor. Published server-origin rows set it to null (no device to echo). Defaults to "authentication_token_id".
 * @property {(broadcast: {channel: string, params: Record<string, ?>, body: ?}) => Promise<void>} [broadcaster] - Delivers declared broadcasts. Defaults to the configuration's channel broadcast.
 * @property {import("../configuration.js").default} [configuration] - Configuration owning the registered models. Defaults to the current configuration.
 * @property {(error: Error) => void} [onError] - Reports post-commit publish failures. Defaults to loud logging.
 * @property {?} [syncModel] - Sync/change model override. Defaults to the registered "Sync" model.
 */

/**
 * Internal derived publish policy for one resource — not an app-facing API.
 * @typedef {object} SyncPublisherResourceConfig
 * @property {SyncPublishBroadcast[] | undefined} broadcasts - Declared broadcasts.
 * @property {SyncPublishDeclarationConfig["eventId"] | undefined} eventId - Event scope resolver.
 * @property {?} modelClass - Server model class for this resource.
 * @property {Array<"create" | "update" | "destroy">} operations - Published operations.
 * @property {string} resourceType - Published resource type.
 * @property {SyncPublishDeclarationConfig["serialize"]} serialize - Payload snapshot builder.
 */

export {}
