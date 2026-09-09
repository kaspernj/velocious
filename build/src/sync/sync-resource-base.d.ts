import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
export type SerializedChangesScope = {
    /**
     * - Plain attribute conditions from the client query.
     */
    conditions: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Client resource/model name the scope was declared for, or null for the all-types (user) scope: one scope covering every resource type this resource authorizes for the caller, so a sync authorizes once however many types it serves.
     */
    resourceType: string | null;
    /**
     * - For the all-types scope, the resource types the client can apply. A cheap delivery/type filter only - it narrows, never widens, what the app's authorization already allows. Null for a type-declared scope.
     */
    resourceTypes: string[] | null;
};
export type ChangeDeliverableSyncEntry = Record<string, ReturnType<typeof JSON.parse>> & {
    resourceId: string;
    resourceType: string;
};
/**
 * Base resource for Velocious sync endpoints.
 *
 * Velocious owns the changes/replay orchestration (scope parsing, feed paging,
 * replay delegation, response shape) while apps subclass and only declare
 * authorization, feed scoping, and their replay service.
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 * @augments {FrontendModelBaseResource<TModelClass>}
 */
export default class SyncResourceBase<TModelClass extends typeof import("../database/record/index.js").default = typeof import("../database/record/index.js").default> extends FrontendModelBaseResource<TModelClass> {
    /** @type {typeof import("../database/record/index.js").default | undefined} */
    static ModelClass: typeof import("../database/record/index.js").default | undefined;
    /**
     * Replay service class handling replay mutations for this resource,
     * declared instead of overriding {@link SyncResourceBase#replayServiceClass}.
     * @type {typeof import("./sync-envelope-replay-service.js").default | undefined}
     */
    static ReplayServiceClass: typeof import("./sync-envelope-replay-service.js").default | undefined;
    /**
     * Declarative quick-search text columns. When declared, an index search on
     * the pseudo-column `quickSearch` expands to an OR of LIKE conditions over
     * these root-table columns instead of hitting the controller default.
     * @type {string[] | null} */
    static quickSearchColumns: string[] | null;
    /**
     * Applies frontend-model index searches, expanding declared quick searches.
     * @param {object} args - Search args.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search params.
     * @returns {void}
     */
    applyFrontendModelIndexSearch({ controller, query, search }: {
        controller: import("../frontend-model-resource/base-resource.js").FrontendModelResourceController;
        query: import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery;
        search: import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch;
    }): void;
    /**
     * Expands a `quickSearch` pseudo-column search into an OR of LIKE conditions
     * over the declared {@link SyncResourceBase.quickSearchColumns}.
     * @param {object} args - Search args.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query to filter.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search payload.
     * @returns {boolean} Whether the search was handled as a quick search.
     */
    applyQuickSearch({ query, search }: {
        query: import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery;
        search: import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch;
    }): boolean;
    /**
     * Returns a stable change-feed page after app authorization.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Change-feed page result.
     */
    changes(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Replays client sync envelopes through the app replay service.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay result with per-sync states.
     */
    replay(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Parses the optional client-declared scope from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {SerializedChangesScope | null} Parsed scope, or null when the client sent none.
     */
    changesScope(params: Record<string, ReturnType<typeof JSON.parse>>): SerializedChangesScope | null;
    /**
     * Parses the optional resource-type list an all-types scope declares.
     * @param {ReturnType<typeof JSON.parse>} value - Raw `scope.resourceTypes` param.
     * @returns {string[] | null} Declared resource types, or null when the client sent none.
     */
    changesScopeResourceTypes(value: ReturnType<typeof JSON.parse>): string[] | null;
    /**
     * Builds the change-feed service serving this changes request.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, scope: SerializedChangesScope | null}} args - Request params and parsed scope.
     * @returns {{changes: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} Change-feed service.
     */
    changeFeedService({ params, scope }: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        scope: SerializedChangesScope | null;
    }): {
        changes: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    };
    /**
     * Builds the app replay service handling this replay request. The resource
     * ability, context, configuration, and locals are plumbed in under the
     * app-declared {@link SyncResourceBase#replayServiceArgs} (app args win) so
     * the default resource-routed replay works without wiring.
     * @returns {import("./sync-envelope-replay-service.js").default} Replay service instance.
     */
    buildReplayService(): import("./sync-envelope-replay-service.js").default;
    /**
     * Returns constructor args for the app replay service.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Replay service constructor args.
     */
    replayServiceArgs(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Returns the sync model class backing the change feed.
     * @returns {typeof import("../database/record/index.js").default} Sync model class.
     */
    syncModelClass(): typeof import("../database/record/index.js").default;
    /**
     * Returns the shared upstream importer for this resource's configuration. Apps
     * use it inside {@link SyncResourceBase#authorizeChanges} (or a legacy trigger
     * endpoint) to run the upstream import that keeps the feed self-sustaining,
     * with coalescing and throttling owned by the framework.
     * @returns {import("./sync-upstream-importer.js").default} Shared importer for the current configuration.
     */
    syncUpstreamImporter(): import("./sync-upstream-importer.js").default;
    /**
     * Authorizes the current context for reading the requested changes.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, scope: SerializedChangesScope | null}} _args - Request params and parsed scope.
     * @returns {Promise<void>} Resolves when access is allowed; throws otherwise.
     */
    authorizeChanges(_args: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        scope: SerializedChangesScope | null;
    }): Promise<void>;
    /**
     * Applies app visibility scoping onto the change-feed query.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, query: import("../database/query/model-class-query.js").default, scope: SerializedChangesScope | null}} _args - Request params, feed query, and parsed scope.
     * @returns {void}
     */
    scopeChangesQuery(_args: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        query: import("../database/query/model-class-query.js").default;
        scope: SerializedChangesScope | null;
    }): void;
    /**
     * Decides whether one published change is deliverable to a user-scope
     * subscription (the framework sync channel's per-delivery access re-check).
     * The default reuses the app's ability scoping: it applies
     * {@link SyncResourceBase#scopeChangesQuery} to the change-feed model — which
     * for an empty-conditions user scope falls back to ability scoping — and
     * checks whether the published change's feed row is visible within that
     * scope. Apps get this for free from the scoping they already declared;
     * override only for custom per-delivery rules.
     *
     * The `sync` argument is the complete broadcast sync entry — immutable
     * sync-row id, actor-specific metadata, and any other publisher fields —
     * with `resourceId`/`resourceType` normalized to strings, so an override
     * can authorize concurrent targeted and shared broadcasts for the same
     * resource identity independently by their exact-row identity. The channel
     * never mutates the published entry; normalization happens on a copy.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, scope: SerializedChangesScope | null, sync: ChangeDeliverableSyncEntry}} args - Request params, subscription scope, and the published sync entry.
     * @returns {Promise<boolean>} Whether the change may be delivered to this subscription.
     */
    changeDeliverable({ params, scope, sync }: {
        params: Record<string, ReturnType<typeof JSON.parse>>;
        scope: SerializedChangesScope | null;
        sync: ChangeDeliverableSyncEntry;
    }): Promise<boolean>;
    /**
     * Resolves the replay service class handling replay mutations: the
     * declarative {@link SyncResourceBase.ReplayServiceClass} static (shared
     * resources included) when declared, otherwise
     * {@link SyncEnvelopeReplayService}, which resource-routes mutations through
     * the plumbed configuration registry. Apps declare the static instead of
     * overriding this method.
     * @returns {typeof import("./sync-envelope-replay-service.js").default} Replay service class.
     */
    replayServiceClass(): typeof import("./sync-envelope-replay-service.js").default;
}
//# sourceMappingURL=sync-resource-base.d.ts.map