import SyncReplayUpsertApplier from "./sync-replay-upsert-applier.js";
export type SyncReplayResourceRegistration = {
    /**
     * - Effective frontend model name.
     */
    modelName: string;
    /**
     * - Routed resource class.
     */
    resourceClass: import("../configuration-types.js").FrontendModelResourceClassType;
    /**
     * - Normalized resource configuration when registry-resolved.
     */
    resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null;
};
export type SyncReplayMutation = {
    /**
     * - Base server/client version observed by the client.
     */
    baseVersion?: string | number | null;
    /**
     * - Original client mutation id from the signed envelope.
     */
    clientMutationId?: string;
    /**
     * - Client-side mutation timestamp.
     */
    clientUpdatedAt: Date;
    /**
     * - Parsed mutation payload.
     */
    data: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Client sync row id for per-sync responses.
     */
    id: ReturnType<typeof JSON.parse>;
    /**
     * - Resource id as a string.
     */
    resourceId: string;
    /**
     * - Resource/model name.
     */
    resourceType: string;
    /**
     * - JSON serialized mutation payload.
     */
    serializedData: string;
    /**
     * - Sync operation type.
     */
    syncType: string;
};
export type SyncReplayBroadcast = {
    /**
     * - Channel name or resolver.
     */
    channel: string | ((args: Record<string, ReturnType<typeof JSON.parse>>) => string);
    /**
     * - Channel routing params.
     */
    broadcastParams: (args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Broadcast body.
     */
    body: (args: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>;
    /**
     * - Optional gate; skipped when it returns false.
     */
    when?: (args: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
};
/**
 * Resolved routed-resource registration for one replay resource type.
 * @typedef {object} SyncReplayResourceRegistration
 * @property {string} modelName - Effective frontend model name.
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Routed resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} resourceConfiguration - Normalized resource configuration when registry-resolved.
 */
/**
 * @typedef {object} SyncReplayMutation
 * @property {string | number | null} [baseVersion] - Base server/client version observed by the client.
 * @property {string} [clientMutationId] - Original client mutation id from the signed envelope.
 * @property {Date} clientUpdatedAt - Client-side mutation timestamp.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} data - Parsed mutation payload.
 * @property {ReturnType<typeof JSON.parse>} id - Client sync row id for per-sync responses.
 * @property {string} resourceId - Resource id as a string.
 * @property {string} resourceType - Resource/model name.
 * @property {string} serializedData - JSON serialized mutation payload.
 * @property {string} syncType - Sync operation type.
 */
/**
 * One declarative broadcast fanned out after a mutation applies.
 * @typedef {object} SyncReplayBroadcast
 * @property {string | ((args: Record<string, ReturnType<typeof JSON.parse>>) => string)} channel - Channel name or resolver.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Channel routing params.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} body - Broadcast body.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => boolean} [when] - Optional gate; skipped when it returns false.
 */
/**
 * Replays client sync envelopes through project supplied authentication,
 * authorization, application, and persistence hooks.
 *
 * This is intentionally transport/model agnostic: Velocious owns the generic
 * replay loop, normalization, stale-client comparison, and per-sync result
 * shape while each app owns its token lookup, model handlers, and
 * domain authorization rules.
 */
export default class SyncEnvelopeReplayService {
    logger: {
        debug?: (...args: Array<unknown>) => void;
        warn?: (...args: Array<unknown>) => void;
    };
    syncModel: any;
    actorForeignKeyColumn: string;
    authenticationTokenModel: any;
    authenticationTokenColumn: string;
    authenticationTokenParam: string;
    persistExtraAttributes: ((args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>) | null;
    persistSerializedData: ((args: {
        mutation: ReturnType<typeof JSON.parse>;
        applyResult: ReturnType<typeof JSON.parse>;
    }) => ReturnType<typeof JSON.parse>) | null;
    broadcaster: ((broadcast: {
        channel: string;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        body: ReturnType<typeof JSON.parse>;
    }) => Promise<void>) | null;
    broadcasts: SyncReplayBroadcast[] | null;
    applyHandlers: Record<string, (args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>> | null;
    configuration: import("../configuration.js").default | null;
    conflictStrategy: {
        strategy?: "optimisticVersion" | "serverWins";
        versionAttribute: string;
    } | null;
    resourceTypeOverrides: Record<string, string | import("../configuration-types.js").FrontendModelResourceClassType> | null;
    ability: import("../authorization/ability.js").default | null;
    abilityContext: Record<string, any> | null;
    locals: Record<string, any> | null;
    /** @type {Map<string, SyncReplayResourceRegistration | null>} */
    _replayResourceRegistrations: Map<string, SyncReplayResourceRegistration | null>;
    /**
     * Creates a sync envelope replay service.
     *
     * When a sync model is given, `findExistingReplaySync` and
     * `persistReplayMutation` get model-backed default implementations. The sync
     * model must expose `findBy`/`create` statics plus instance
     * `assign`/`save`/`clientUpdatedAt` and `advanceServerSequence` (the
     * change-feed sequence contract), and the actor returned from
     * `authenticateReplay` must expose an `id()` method.
     * @param {object} [args] - Constructor arguments.
     * @param {{debug?: (...args: Array<unknown>) => void, warn?: (...args: Array<unknown>) => void}} [args.logger] - Logger used for normalization warnings.
     * @param {ReturnType<typeof JSON.parse>} [args.syncModel] - Sync/change model enabling model-backed default hooks.
     * @param {string} [args.actorForeignKeyColumn] - Sync model column linking rows to the replay actor.
     * @param {ReturnType<typeof JSON.parse>} [args.authenticationTokenModel] - Token model enabling the default token-lookup authenticateReplay.
     * @param {string} [args.authenticationTokenColumn] - Token model column holding the token. Defaults to "token".
     * @param {string} [args.authenticationTokenParam] - Request param carrying the token. Defaults to "authenticationToken".
     * @param {Record<string, ((args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>) | ConstructorParameters<typeof SyncReplayUpsertApplier>[0]>} [args.applyHandlers] - Per-resourceType apply handlers (functions or declarative upsert-applier specs) enabling the default applyReplayMutation dispatch. Deprecated: prefer resource routing via `configuration`/`resourceTypeOverrides`; applyHandlers remain for released adopters and will be removed after their migration.
     * @param {(args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>} [args.persistExtraAttributes] - Extra attributes merged into the model-backed persisted row (e.g. an event scope column).
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>}) => ReturnType<typeof JSON.parse>} [args.persistSerializedData] - Overrides the persisted data payload (object results are JSON stringified).
     * @param {(broadcast: {channel: string, params: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>}) => Promise<void>} [args.broadcaster] - Delivers declarative broadcasts. Required when broadcasts are configured.
     * @param {SyncReplayBroadcast[]} [args.broadcasts] - Broadcasts fanned out by the default afterReplayMutation.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration whose frontend-model registry routes mutations to resource classes.
     * @param {{strategy?: "optimisticVersion" | "serverWins", versionAttribute: string} | null} [args.conflictStrategy] - Optional base-version conflict detection for routed upserts. Only `optimisticVersion` and `serverWins` are supported for backend replay because the server does not have the client's base snapshot. When `strategy` is omitted it defaults to `optimisticVersion`, matching `resolveSyncConflict` and normalized resource config. When configured, a mutation whose baseVersion does not match the current server versionAttribute is rejected with a structured conflict result instead of being applied.
     * @param {Record<string, import("../configuration-types.js").FrontendModelResourceClassType | string>} [args.resourceTypeOverrides] - Per-resourceType routing overrides: a resource class, or a string alias resolved through the registry.
     * @param {import("../authorization/ability.js").default} [args.ability] - Ability scoping routed record lookups and create membership checks.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.abilityContext] - Ability context passed to routed resources.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.locals] - Locals passed to routed resources.
     */
    constructor(args?: {
        logger?: {
            debug?: (...args: Array<unknown>) => void;
            warn?: (...args: Array<unknown>) => void;
        };
        syncModel?: ReturnType<typeof JSON.parse>;
        actorForeignKeyColumn?: string;
        authenticationTokenModel?: ReturnType<typeof JSON.parse>;
        authenticationTokenColumn?: string;
        authenticationTokenParam?: string;
        applyHandlers?: Record<string, ((args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>) | ConstructorParameters<typeof SyncReplayUpsertApplier>[0]>;
        persistExtraAttributes?: (args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>;
        persistSerializedData?: (args: {
            mutation: ReturnType<typeof JSON.parse>;
            applyResult: ReturnType<typeof JSON.parse>;
        }) => ReturnType<typeof JSON.parse>;
        broadcaster?: (broadcast: {
            channel: string;
            params: Record<string, ReturnType<typeof JSON.parse>>;
            body: ReturnType<typeof JSON.parse>;
        }) => Promise<void>;
        broadcasts?: SyncReplayBroadcast[];
        configuration?: import("../configuration.js").default;
        conflictStrategy?: {
            strategy?: "optimisticVersion" | "serverWins";
            versionAttribute: string;
        } | null;
        resourceTypeOverrides?: Record<string, import("../configuration-types.js").FrontendModelResourceClassType | string>;
        ability?: import("../authorization/ability.js").default;
        abilityContext?: Record<string, ReturnType<typeof JSON.parse>>;
        locals?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Wraps declarative apply-handler specs in upsert appliers.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} applyHandlers - Raw apply handlers.
     * @returns {Record<string, (args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>} Callable handlers by resource type.
     */
    builtApplyHandlers(applyHandlers: Record<string, ReturnType<typeof JSON.parse>>): Record<string, (args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>;
    /**
     * Replays a sync batch.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params carrying authentication and syncs.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [requestState] - Request-local state passed to authentication/sync extraction hooks; subclasses may use this to share pre-computed per-request data without instance mutation.
     * @returns {Promise<{syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>, status?: string, errorCode?: string, errorMessage?: string}>} Replay response.
     */
    replay(params: Record<string, ReturnType<typeof JSON.parse>>, requestState?: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        status?: string;
        errorCode?: string;
        errorMessage?: string;
    }>;
    /**
     * Authenticates the sync batch actor.
     *
     * Defaults to a token-model lookup when `authenticationTokenModel` is
     * configured; otherwise apps override this hook.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [_requestState] - Request-local state populated by subclasses before the base replay loop runs.
     * @returns {Promise<{authenticated: true, actor: ReturnType<typeof JSON.parse>} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
     */
    authenticateReplay(params: Record<string, ReturnType<typeof JSON.parse>>, _requestState?: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        authenticated: true;
        actor: ReturnType<typeof JSON.parse>;
    } | {
        authenticated: false;
        errorCode: string;
        errorMessage: string;
    }>;
    /**
     * Builds per-batch mutable context for caches shared across sync items.
     * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} _args - Actor, request params, and request-local state.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
     */
    buildReplayContext(_args: {
        actor: ReturnType<typeof JSON.parse>;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        requestState: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Returns raw sync entries from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [_requestState] - Request-local state populated by subclasses before the base replay loop runs.
     * @returns {Array<ReturnType<typeof JSON.parse>>} Raw sync entries.
     */
    replaySyncs(params: Record<string, ReturnType<typeof JSON.parse>>, _requestState?: Record<string, ReturnType<typeof JSON.parse>>): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Normalizes one sync entry.
     * @param {ReturnType<typeof JSON.parse>} rawSync - Raw sync entry.
     * @returns {{ok: true, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized mutation or failed response.
     */
    normalizeReplaySync(rawSync: ReturnType<typeof JSON.parse>): {
        ok: true;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    } | {
        ok: false;
        response: Record<string, ReturnType<typeof JSON.parse>>;
    };
    /**
     * Normalizes one sync data payload.
     * @param {{data: ReturnType<typeof JSON.parse>, id: ReturnType<typeof JSON.parse>, resourceId: string, resourceType: string}} args - Sync payload normalization arguments.
     * @returns {{ok: true, data: Record<string, ReturnType<typeof JSON.parse>>} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized payload or failed response.
     */
    normalizeReplaySyncData({ data, id, resourceId, resourceType }: {
        data: ReturnType<typeof JSON.parse>;
        id: ReturnType<typeof JSON.parse>;
        resourceId: string;
        resourceType: string;
    }): {
        ok: true;
        data: Record<string, ReturnType<typeof JSON.parse>>;
    } | {
        ok: false;
        response: Record<string, ReturnType<typeof JSON.parse>>;
    };
    /**
     * Authorizes one normalized mutation.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
     * @returns {Promise<{allowed: boolean, reason?: string}>} Access result.
     */
    authorizeReplayMutation(_args: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
    /**
     * Loads the previously stored sync/change row for stale-client comparison.
     *
     * Defaults to a sync-model lookup by actor and resource identity when a sync
     * model is configured; otherwise apps override this hook.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Existing sync row.
     */
    findExistingReplaySync({ actor, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Resolves the persisted actor id used by model-backed default hooks.
     * @param {ReturnType<typeof JSON.parse>} actor - Actor returned from authenticateReplay.
     * @returns {ReturnType<typeof JSON.parse>} Actor id.
     */
    replayActorId(actor: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Returns whether a normalized mutation should be applied to domain models.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<boolean>} Whether to apply the mutation.
     */
    shouldApplyReplayMutation({ existingSync, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<boolean>;
    /**
     * Resolves the client timestamp from an existing sync row.
     * @param {ReturnType<typeof JSON.parse>} existingSync - Existing sync row.
     * @returns {Date | null} Existing client timestamp.
     */
    existingReplaySyncClientUpdatedAt(existingSync: ReturnType<typeof JSON.parse>): Date | null;
    /**
     * Checks whether a skipped mutation exactly matches the persisted replay row.
     * Older distinct mutations retain the established successful stale-skip response.
     * @param {{existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Existing row and incoming mutation.
     * @returns {boolean} Whether this is a duplicate replay.
     */
    isDuplicateReplayMutation({ existingSync, mutation }: {
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): boolean;
    /**
     * Reads a model-backed sync-row value through its accessor or plain property.
     * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
     * @param {string} attributeName - Attribute name.
     * @returns {ReturnType<typeof JSON.parse>} Stored value.
     */
    replaySyncRecordValue(syncRecord: ReturnType<typeof JSON.parse>, attributeName: string): ReturnType<typeof JSON.parse>;
    /**
     * Reads durable replay acknowledgement metadata from a model-backed sync row.
     * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
     * @returns {{acknowledgementVersion: string | number | null, clientMutationId: string, payloadFingerprint: string} | null} Persisted metadata.
     */
    replayPersistedMetadata(syncRecord: ReturnType<typeof JSON.parse>): {
        acknowledgementVersion: string | number | null;
        clientMutationId: string;
        payloadFingerprint: string;
    } | null;
    /**
     * Applies one normalized mutation to domain models.
     *
     * Dispatches through the configured apply-handler registry first (compat
     * precedence); mutations without a matching handler fall through to
     * resource routing when a configuration or resourceTypeOverrides are
     * configured, and otherwise fail loudly.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
     */
    applyReplayMutation(args: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Returns whether resource routing is configured on this service.
     * @returns {boolean} Whether mutations route to frontend-model resources.
     */
    routingConfigured(): boolean;
    /**
     * Resolves the routed resource registration for a resource type, memoized
     * per replay service. Overrides win over the configuration registry; string
     * overrides are aliases resolved through the registry.
     * @param {string} resourceType - Mutation resource type.
     * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
     */
    replayResourceRegistration(resourceType: string): SyncReplayResourceRegistration | null;
    /**
     * Uncached routed-resource resolution behind {@link SyncEnvelopeReplayService#replayResourceRegistration}.
     * @param {string} resourceType - Mutation resource type.
     * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
     */
    resolveReplayResourceRegistration(resourceType: string): SyncReplayResourceRegistration | null;
    /**
     * Resolves the ability and resource context used to authorize routed
     * resources. Defaults to the constructor-wide ability/abilityContext;
     * subclasses (signed replay) override this to derive authorization from a
     * verified actor/grant instead of uploader-global state.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}} _args - Replay actor and batch context.
     * @returns {Promise<{ability: import("../authorization/ability.js").default | undefined, abilityContext: Record<string, ReturnType<typeof JSON.parse>>}>} Ability and resource context.
     */
    replayAbilityFor(_args: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<{
        ability: import("../authorization/ability.js").default | undefined;
        abilityContext: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Builds the routed resource instance handling one mutation.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.actor - Replay actor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {SyncReplayResourceRegistration} args.registration - Resolved resource registration.
     * @returns {Promise<import("../frontend-model-resource/base-resource.js").default>} Routed resource instance.
     */
    buildReplayResource({ actor, context, mutation, registration }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        registration: SyncReplayResourceRegistration;
    }): Promise<import("../frontend-model-resource/base-resource.js").default>;
    /**
     * Applies one mutation through its routed frontend-model resource:
     * authorization, ability-scoped record lookup, schema normalization and
     * assign/save for updates, save-then-check membership creates, destroys for
     * deletes, and the resource's afterSyncApply tail. Client-safe failures
     * throw safe errors that fail the single sync.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with record, created/deleted flags, and afterSyncApply extras.
     */
    applyRoutedReplayMutation({ actor, context, existingSync, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Dispatches a routed sync mutation whose syncType matches a resource-declared
     * custom command. Returns null when the mutation is not a command so the
     * caller can fall through to the default upsert path.
     * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, resource: import("../frontend-model-resource/base-resource.js").default}} args - Command dispatch args.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} Command apply result or null.
     */
    applyRoutedReplayCommand({ context, mutation, resource }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Resolves the custom-command configuration declared on a routed resource.
     * @param {import("../frontend-model-resource/base-resource.js").default} resource - Routed resource instance.
     * @returns {{collectionCommands: Record<string, string>, memberCommands: Record<string, string>}} Command config.
     */
    resourceCommandConfig(resource: import("../frontend-model-resource/base-resource.js").default): {
        collectionCommands: Record<string, string>;
        memberCommands: Record<string, string>;
    };
    /**
     * Resolves the resource method name for a syncType when it names a declared
     * custom command.
     * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, syncType: string}} args - Lookup args.
     * @returns {string | null} Method name or null.
     */
    commandMethodNameForSyncType({ commandConfig, syncType }: {
        commandConfig: {
            collectionCommands: Record<string, string>;
            memberCommands: Record<string, string>;
        };
        syncType: string;
    }): string | null;
    /**
     * Builds the arguments object passed to a resource command method. Member
     * commands receive the envelope's resourceId as `id`; the envelope identity
     * is assigned after the payload so a payload `id` can never retarget the
     * command away from the resource the authorization hooks approved.
     * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, commandMethodName: string, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Args builder args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Command method arguments.
     */
    commandArgsForMutation({ commandConfig, commandMethodName, mutation }: {
        commandConfig: {
            collectionCommands: Record<string, string>;
            memberCommands: Record<string, string>;
        };
        commandMethodName: string;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Applies a routed delete mutation. The record is marked as a server apply
     * for the duration of the replay-owned destroy - an active SyncPublisher
     * never publishes the replayed delete a second time (the replay owns its
     * own persist and broadcasts), while later server-side writes to the same
     * instance publish normally again.
     * @param {object} args - Options.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the deleted flag.
     */
    applyRoutedReplayDelete({ mutation, resource }: {
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Applies a routed upsert mutation: permitted payload attributes are
     * assigned and saved onto the found record (the record layer owns value
     * casting and validation), and missing records are created with the
     * client-generated primary key plus a save-then-check membership check.
     * Written records are marked as server applies for the duration of the
     * replay-owned write - an active SyncPublisher never publishes the replayed
     * mutation a second time (the replay owns its own persist and broadcasts),
     * while later server-side writes to the same instance publish normally
     * again. Model validation failures become client-safe per-sync failures
     * carrying the translated validation message.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with record, created flag, and afterSyncApply extras.
     */
    applyRoutedReplayUpsert({ context, mutation, resource }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Checks whether a routed upsert mutation conflicts with the current server
     * state when the service is configured with a conflict strategy. A mutation
     * whose baseVersion does not match the server's current versionAttribute is
     * rejected with a structured conflict payload instead of being applied.
     * @param {object} args - Conflict-check args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted mutation attributes.
     * @param {import("../database/record/index.js").default | null} args.existingRecord - Existing server record.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Conflict apply result, or null when no conflict.
     */
    routedReplayConflictResult({ attributes, existingRecord, mutation, resource }: {
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        existingRecord: import("../database/record/index.js").default | null;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Projects affected mutation fields through the resource's readable
     * attribute contract. Writable-but-hidden fields are omitted, while custom
     * `<attribute>Attribute(model)` serializers and model accessors remain the
     * source of frontend-visible values (Date values are kept raw so the normal
     * frontend-model transport serializer can emit its date marker). Projected
     * keys use canonical model attribute names even when the mutation used a
     * database-column alias. The full model attribute hash is never exposed.
     * @param {object} args - Projection args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted affected mutation attributes.
     * @param {import("../database/record/index.js").default} args.existingRecord - Authorized server record.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Serialized readable affected attributes.
     */
    serializedRoutedConflictAttributes({ attributes, existingRecord, resource }: {
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        existingRecord: import("../database/record/index.js").default;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Filters a routed mutation payload down to the resource's declared
     * writable-attribute permit list. Accepted keys per permitted attribute are
     * the camelCase attribute name plus the model's actual column name; unknown
     * keys fail the sync loudly. The primary key is dropped when permitted
     * (snapshot payloads) — the envelope's resourceId is the authoritative
     * record identity, so a payload id can never retarget the row.
     * @param {object} args - Options.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Permitted attributes for record.assign.
     */
    permittedRoutedAttributes({ mutation, resource }: {
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Creates the routed record with the client-generated primary key (marked
     * as a server apply for the duration of the create - including the
     * membership-check compensation destroy - so an active SyncPublisher never
     * publishes the replayed create a second time), then
     * verifies create-scope membership when an ability is configured: records
     * outside the ability's create scope are destroyed again and fail the sync
     * with the resource-declared reason. A record that already exists outside
     * the resource's lookup scope fails the sync as an authorization denial
     * instead of colliding on the primary key.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted payload attributes.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<import("../database/record/index.js").default>} Created record.
     */
    createRoutedReplayRecord({ attributes, mutation, resource }: {
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        resource: import("../frontend-model-resource/base-resource.js").default;
    }): Promise<import("../database/record/index.js").default>;
    /**
     * Saves a routed record, converting model validation failures into
     * client-safe per-sync errors carrying the translated validation message.
     * @param {import("../database/record/index.js").default} record - Record to save.
     * @returns {Promise<void>} Resolves when saved.
     */
    saveRoutedReplayRecord(record: import("../database/record/index.js").default): Promise<void>;
    /**
     * Maps a routed save/create failure: model validation errors become
     * client-safe errors with their translated messages, everything else
     * propagates unchanged.
     * @param {ReturnType<typeof JSON.parse>} error - Thrown save/create error.
     * @returns {Error} Error to rethrow.
     */
    routedReplaySaveError(error: ReturnType<typeof JSON.parse>): Error;
    /**
     * Resolves an apply result for stale mutations that should not touch domain models.
     * Exact duplicates resolve the current routed record so the acknowledgement
     * can include its authoritative version without applying the mutation again.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
     */
    skippedReplayMutation({ actor, context, existingSync, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Persists one normalized mutation into the app sync/change store.
     *
     * Defaults to a stale-guarded sync-model upsert (with server re-sequencing on
     * updates) when a sync model is configured; otherwise apps override this hook.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay persistence arguments.
     * @returns {Promise<void>}
     */
    persistReplayMutation({ actor, applyResult, context, existingSync, mutation, shouldApply }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        applyResult: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        shouldApply: boolean;
    }): Promise<void>;
    /**
     * Builds the sync-model attributes persisted by the model-backed default.
     * @param {{actor: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor and mutation.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync row attributes.
     */
    replayPersistAttributes({ actor, mutation }: {
        actor: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs side effects after a successful mutation replay and persistence.
     *
     * Defaults to fanning the applied result out through the configured
     * declarative broadcasts.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay side-effect arguments.
     * @returns {Promise<void>}
     */
    afterReplayMutation(args: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
        existingSync: ReturnType<typeof JSON.parse>;
        applyResult: ReturnType<typeof JSON.parse>;
        mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation;
        shouldApply: boolean;
    }): Promise<void>;
}
/**
 * Returns a deterministic, MySQL-safe advisory-lock name for a routed replay
 * resource identity. The full `{resourceType, resourceId}` identity is hashed
 * with SHA-256 and truncated to 32 hex characters so the final name stays well
 * under MySQL/MariaDB's 64-character `GET_LOCK` limit while remaining
 * collision-resistant.
 * @param {object} args - Lock identity args.
 * @param {string} args.resourceId - Resource id.
 * @param {string} args.resourceType - Resource type.
 * @returns {string} - Advisory lock name.
 */
export declare function syncReplayConflictLockName({ resourceId, resourceType }: {
    resourceId: string;
    resourceType: string;
}): string;
//# sourceMappingURL=sync-envelope-replay-service.d.ts.map