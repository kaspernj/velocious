// @ts-check

/**
 * Args resolved against a publish declaration's deprecated broadcasts after a
 * published server-side mutation commits.
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
 * @deprecated Publishing broadcasts the standard sync envelope on the framework sync channel automatically; declare app-channel broadcasts only for legacy channels old app versions still subscribe.
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
 * feed and broadcast the standard sync envelope on the framework sync
 * channel automatically once their transaction commits); `publish: true`
 * opts in with all defaults and `publish: false` opts a model out explicitly.
 * @template [TModel=any]
 * @typedef {object} SyncPublishDeclarationConfig
 * @property {(record: TModel) => Record<string, ?> | Promise<Record<string, ?>>} [serialize] - Builds the published payload snapshot from the mutated record (snapshotted at mutation time). Defaults to the record's attributes with Date values serialized to ISO strings.
 * @property {Record<string, string>} [scopeAttributes] - Record-attribute name overrides per scope attribute declared on the sync model's `static syncScopeAttributes`. By default each declared scope attribute reads the record's attribute of the same name when the model has one, else the record's own id (scope-root models).
 * @property {string | ((record: TModel) => string | number | null | Promise<string | number | null>)} [eventId] - Deprecated 1.0.503 form: attribute-name string (or resolver function) persisted to a fixed event_id sync-row column and broadcast as a fixed `eventId` scoping param. Declare `static syncScopeAttributes` on the sync model plus `scopeAttributes` overrides instead.
 * @property {SyncPublishBroadcast[]} [broadcasts] - Deprecated: declarative app-channel broadcasts fanned out after the framework sync channel broadcast. The framework broadcast happens automatically; keep this only for legacy channels old app versions still subscribe.
 * @property {Array<"create" | "update" | "destroy">} [operations] - Published operations. Defaults to creates and updates; destroys are opt-in because a server destroy is often cleanup rather than a synced delete.
 * @property {string} [resourceType] - Published resource type. Defaults to the model name.
 */

/**
 * Model-level publish declaration value: `true` publishes with all defaults,
 * `false` opts out explicitly, an object customizes the published payload and scoping.
 * @template [TModel=any]
 * @typedef {boolean | SyncPublishDeclarationConfig<TModel>} SyncPublishDeclaration
 */

/**
 * Options for building a sync publisher. Published resources are derived from
 * the configuration's registered models (`static sync` publish declarations).
 * @typedef {object} SyncPublisherOptions
 * @property {string} [actorForeignKeyColumn] - Sync model column linking rows to a device actor. Published server-origin rows set it to null (no device to echo). Defaults to "authentication_token_id".
 * @property {(broadcast: {channel: string, params: Record<string, ?>, body: ?}) => Promise<void>} [broadcaster] - Delivers the framework sync channel broadcast and any deprecated declared broadcasts. Defaults to the configuration's channel broadcast.
 * @property {import("../configuration.js").default} [configuration] - Configuration owning the registered models. Defaults to the current configuration.
 * @property {(error: Error) => void} [onError] - Reports post-commit publish failures. Defaults to loud logging.
 * @property {?} [syncModel] - Sync/change model override. Defaults to the registered "Sync" model.
 */

/**
 * One derived scope-partition source for a published resource — not an
 * app-facing API. The value is persisted to the sync row's `columnName` and
 * broadcast under `scopeAttribute` on the framework sync channel.
 * @typedef {object} SyncPublisherScopePlanEntry
 * @property {string} columnName - Sync-row column persisting the scope value.
 * @property {string | null} recordAttribute - Record attribute read for the scope value, or null when the record's own id is the scope (scope-root models).
 * @property {((record: ?) => string | number | null | Promise<string | number | null>) | undefined} resolver - Deprecated eventId resolver function.
 * @property {string} scopeAttribute - Scope attribute name broadcast as the framework channel scoping param.
 */

/**
 * Internal derived publish policy for one resource — not an app-facing API.
 * @typedef {object} SyncPublisherResourceConfig
 * @property {SyncPublishBroadcast[] | undefined} broadcasts - Deprecated declared app-channel broadcasts.
 * @property {?} modelClass - Server model class for this resource.
 * @property {Array<"create" | "update" | "destroy">} operations - Published operations.
 * @property {Array<SyncPublisherScopePlanEntry>} scopePlan - Derived scope-partition plan.
 * @property {(record: ?) => Record<string, ?> | Promise<Record<string, ?>>} serialize - Payload snapshot builder (the declaration's serialize or the default attribute serializer).
 * @property {string} resourceType - Published resource type.
 */

export {}
