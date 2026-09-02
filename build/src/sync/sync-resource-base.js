// @ts-check
import { forcedNonBlankString } from "typanic";
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js";
import SyncModelChangeFeedService from "./sync-model-change-feed-service.js";
import { syncUpstreamImporterForConfiguration } from "./sync-upstream-importer.js";
import VelociousError from "../velocious-error.js";
/**
 * Optional client-declared sync scope carried on a changes request.
 * @typedef {object} SerializedChangesScope
 * @property {Record<string, ReturnType<typeof JSON.parse>>} conditions - Plain attribute conditions from the client query.
 * @property {string | null} resourceType - Client resource/model name the scope was declared for, or null for the all-types (user) scope: one scope covering every resource type this resource authorizes for the caller, so a sync authorizes once however many types it serves.
 * @property {string[] | null} resourceTypes - For the all-types scope, the resource types the client can apply. A cheap delivery/type filter only - it narrows, never widens, what the app's authorization already allows. Null for a type-declared scope.
 */
/**
 * One published sync entry as delivered to the per-delivery access re-check
 * ({@link SyncResourceBase#changeDeliverable}): the complete broadcast sync
 * entry — including the immutable sync-row id, actor-specific metadata, and
 * any other app fields the publisher put on it — with `resourceId` and
 * `resourceType` normalized to strings. Apps authorizing by exact-row
 * identity read the extra fields; overrides that only read
 * `resourceId`/`resourceType` keep working unchanged.
 * @typedef {Record<string, ReturnType<typeof JSON.parse>> & {resourceId: string, resourceType: string}} ChangeDeliverableSyncEntry
 */
const QUICK_SEARCH_COLUMN = "quickSearch";
/**
 * Base resource for Velocious sync endpoints.
 *
 * Velocious owns the changes/replay orchestration (scope parsing, feed paging,
 * replay delegation, response shape) while apps subclass and only declare
 * authorization, feed scoping, and their replay service.
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 * @augments {FrontendModelBaseResource<TModelClass>}
 */
export default class SyncResourceBase extends FrontendModelBaseResource {
    /**
     * Replay service class handling replay mutations for this resource,
     * declared instead of overriding {@link SyncResourceBase#replayServiceClass}.
     * @type {typeof import("./sync-envelope-replay-service.js").default | undefined}
     */
    static ReplayServiceClass = undefined;
    /**
     * Declarative quick-search text columns. When declared, an index search on
     * the pseudo-column `quickSearch` expands to an OR of LIKE conditions over
     * these root-table columns instead of hitting the controller default.
     * @type {string[] | null} */
    static quickSearchColumns = null;
    /**
     * Applies frontend-model index searches, expanding declared quick searches.
     * @param {object} args - Search args.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search params.
     * @returns {void}
     */
    applyFrontendModelIndexSearch({ controller, query, search }) {
        if (this.applyQuickSearch({ query, search }))
            return;
        super.applyFrontendModelIndexSearch({ controller, query, search });
    }
    /**
     * Expands a `quickSearch` pseudo-column search into an OR of LIKE conditions
     * over the declared {@link SyncResourceBase.quickSearchColumns}.
     * @param {object} args - Search args.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} args.query - Query to filter.
     * @param {import("../frontend-model-resource/base-resource.js").FrontendModelResourceSearch} args.search - Search payload.
     * @returns {boolean} Whether the search was handled as a quick search.
     */
    applyQuickSearch({ query, search }) {
        const quickSearchColumns = /** @type {typeof SyncResourceBase} */ (this.constructor).quickSearchColumns;
        if (!quickSearchColumns || quickSearchColumns.length === 0)
            return false;
        if (search.path.length > 0 || search.column !== QUICK_SEARCH_COLUMN)
            return false;
        if (search.operator !== "like") {
            throw VelociousError.safe("Sync quick search must use the like operator.", { code: "sync-invalid-quick-search" });
        }
        if (typeof search.value !== "string") {
            throw VelociousError.safe("Sync quick search must be a string.", { code: "sync-invalid-quick-search" });
        }
        const trimmedValue = search.value.trim();
        if (!trimmedValue)
            return true;
        const tableSql = query.driver.quoteTable(query.getTableReferenceForJoin());
        const likeValue = `%${trimmedValue}%`;
        const conditions = quickSearchColumns.map((columnName) => (`${tableSql}.${query.driver.quoteColumn(columnName)} LIKE ${query.driver.quote(likeValue)}`));
        query.where(`(${conditions.join(" OR ")})`);
        return true;
    }
    // The declarative `static writableAttributes` permit list lives on
    // FrontendModelBaseResource so every frontend-model resource can declare
    // one; sync resources inherit it unchanged.
    /**
     * Returns a stable change-feed page after app authorization.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Change-feed page result.
     */
    async changes() {
        const params = this.params();
        const scope = this.changesScope(params);
        await this.authorizeChanges({ params, scope });
        return await this.changeFeedService({ params, scope }).changes();
    }
    /**
     * Replays client sync envelopes through the app replay service.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay result with per-sync states.
     */
    async replay() {
        const result = await this.buildReplayService().replay(this.params());
        if (result.status === "error")
            return result;
        return { status: "success", syncs: result.syncs };
    }
    /**
     * Parses the optional client-declared scope from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {SerializedChangesScope | null} Parsed scope, or null when the client sent none.
     */
    changesScope(params) {
        const scope = params.scope;
        if (scope === undefined || scope === null)
            return null;
        if (typeof scope !== "object" || Array.isArray(scope)) {
            throw new Error(`Sync changes scope must be an object, got: ${String(scope)}`);
        }
        const scopeParams = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (scope);
        const resourceType = scopeParams.resourceType === null || scopeParams.resourceType === undefined
            ? null
            : forcedNonBlankString(scopeParams.resourceType, "resourceType");
        const resourceTypes = this.changesScopeResourceTypes(scopeParams.resourceTypes);
        const conditions = scopeParams.conditions;
        if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
            throw new Error(`Sync changes scope.conditions must be an object, got: ${String(conditions)}`);
        }
        return { conditions: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (conditions), resourceType, resourceTypes };
    }
    /**
     * Parses the optional resource-type list an all-types scope declares.
     * @param {ReturnType<typeof JSON.parse>} value - Raw `scope.resourceTypes` param.
     * @returns {string[] | null} Declared resource types, or null when the client sent none.
     */
    changesScopeResourceTypes(value) {
        if (value === undefined || value === null)
            return null;
        if (!Array.isArray(value))
            throw new Error(`Sync changes scope.resourceTypes must be an array, got: ${String(value)}`);
        return value.map((resourceType) => forcedNonBlankString(resourceType, "resourceTypes"));
    }
    /**
     * Builds the change-feed service serving this changes request.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, scope: SerializedChangesScope | null}} args - Request params and parsed scope.
     * @returns {{changes: () => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} Change-feed service.
     */
    changeFeedService({ params, scope }) {
        return new SyncModelChangeFeedService({
            modelClass: this.syncModelClass(),
            params,
            scopeQuery: ({ query }) => this.scopeChangesQuery({ params, query, scope })
        });
    }
    /**
     * Builds the app replay service handling this replay request. The resource
     * ability, context, configuration, and locals are plumbed in under the
     * app-declared {@link SyncResourceBase#replayServiceArgs} (app args win) so
     * the default resource-routed replay works without wiring.
     * @returns {import("./sync-envelope-replay-service.js").default} Replay service instance.
     */
    buildReplayService() {
        const ReplayServiceClass = this.replayServiceClass();
        return new ReplayServiceClass({
            ability: this.ability,
            abilityContext: this.getContext(),
            configuration: this.controller ? this.controllerInstance().getConfiguration() : undefined,
            locals: this.getLocals(),
            ...this.replayServiceArgs()
        });
    }
    /**
     * Returns constructor args for the app replay service.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Replay service constructor args.
     */
    replayServiceArgs() {
        return {};
    }
    /**
     * Returns the sync model class backing the change feed.
     * @returns {typeof import("../database/record/index.js").default} Sync model class.
     */
    syncModelClass() {
        const modelClass = /** @type {typeof SyncResourceBase} */ (this.constructor).ModelClass;
        if (!modelClass)
            throw new Error(`${this.constructor.name} must define static ModelClass`);
        return modelClass;
    }
    /**
     * Returns the shared upstream importer for this resource's configuration. Apps
     * use it inside {@link SyncResourceBase#authorizeChanges} (or a legacy trigger
     * endpoint) to run the upstream import that keeps the feed self-sustaining,
     * with coalescing and throttling owned by the framework.
     * @returns {import("./sync-upstream-importer.js").default} Shared importer for the current configuration.
     */
    syncUpstreamImporter() {
        return syncUpstreamImporterForConfiguration(this.configuration());
    }
    /**
     * Authorizes the current context for reading the requested changes.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, scope: SerializedChangesScope | null}} _args - Request params and parsed scope.
     * @returns {Promise<void>} Resolves when access is allowed; throws otherwise.
     */
    async authorizeChanges(_args) {
        throw new Error("SyncResourceBase#authorizeChanges must be implemented");
    }
    /**
     * Applies app visibility scoping onto the change-feed query.
     * @param {{params: Record<string, ReturnType<typeof JSON.parse>>, query: import("../database/query/model-class-query.js").default, scope: SerializedChangesScope | null}} _args - Request params, feed query, and parsed scope.
     * @returns {void}
     */
    scopeChangesQuery(_args) {
        throw new Error("SyncResourceBase#scopeChangesQuery must be implemented");
    }
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
    async changeDeliverable({ params, scope, sync }) {
        const query = this.syncModelClass().where({});
        this.scopeChangesQuery({ params, query, scope });
        query.where({ resource_id: String(sync.resourceId), resource_type: String(sync.resourceType) });
        return Boolean(await query.first());
    }
    /**
     * Resolves the replay service class handling replay mutations: the
     * declarative {@link SyncResourceBase.ReplayServiceClass} static (shared
     * resources included) when declared, otherwise
     * {@link SyncEnvelopeReplayService}, which resource-routes mutations through
     * the plumbed configuration registry. Apps declare the static instead of
     * overriding this method.
     * @returns {typeof import("./sync-envelope-replay-service.js").default} Replay service class.
     */
    replayServiceClass() {
        const ResourceClass = /** @type {typeof SyncResourceBase} */ (this.constructor);
        const SharedResource = /** @type {typeof SyncResourceBase | null} */ (ResourceClass.sharedResourceClass() ?? null);
        return ResourceClass.ReplayServiceClass ?? SharedResource?.ReplayServiceClass ?? SyncEnvelopeReplayService;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZXNvdXJjZS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1yZXNvdXJjZS1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsb0JBQW9CLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFFNUMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sMEJBQTBCLE1BQU0scUNBQXFDLENBQUE7QUFDNUUsT0FBTyxFQUFDLG9DQUFvQyxFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDaEYsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFFbEQ7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxtQkFBbUIsR0FBRyxhQUFhLENBQUE7QUFFekM7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFpQixTQUFRLHlCQUF5QjtJQUNyRTs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQTtJQUVyQzs7OztpQ0FJNkI7SUFDN0IsTUFBTSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQTtJQUVoQzs7Ozs7OztPQU9HO0lBQ0gsNkJBQTZCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBQztRQUN2RCxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUMsQ0FBQztZQUFFLE9BQU07UUFFbEQsS0FBSyxDQUFDLDZCQUE2QixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO0lBQ2xFLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsZ0JBQWdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFDO1FBQzlCLE1BQU0s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QUFNLGFBQWEsR0FBRyxzQ0FBc0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUMvRSxNQUFNLGNBQWMsR0FBRyw2Q0FBNkMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsRUFBRSxJQUFJLElBQUksQ0FBQyxDQUFBO1FBRWxILE9BQU8sYUFBYSxDQUFDLGtCQUFrQixJQUFJLGNBQWMsRUFBRSxrQkFBa0IsSUFBSSx5QkFBeUIsQ0FBQTtJQUM1RyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtmb3JjZWROb25CbGFua1N0cmluZ30gZnJvbSBcInR5cGFuaWNcIlxuXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSBmcm9tIFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCJcbmltcG9ydCBTeW5jTW9kZWxDaGFuZ2VGZWVkU2VydmljZSBmcm9tIFwiLi9zeW5jLW1vZGVsLWNoYW5nZS1mZWVkLXNlcnZpY2UuanNcIlxuaW1wb3J0IHtzeW5jVXBzdHJlYW1JbXBvcnRlckZvckNvbmZpZ3VyYXRpb259IGZyb20gXCIuL3N5bmMtdXBzdHJlYW0taW1wb3J0ZXIuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuXG4vKipcbiAqIE9wdGlvbmFsIGNsaWVudC1kZWNsYXJlZCBzeW5jIHNjb3BlIGNhcnJpZWQgb24gYSBjaGFuZ2VzIHJlcXVlc3QuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTZXJpYWxpemVkQ2hhbmdlc1Njb3BlXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFBsYWluIGF0dHJpYnV0ZSBjb25kaXRpb25zIGZyb20gdGhlIGNsaWVudCBxdWVyeS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcmVzb3VyY2VUeXBlIC0gQ2xpZW50IHJlc291cmNlL21vZGVsIG5hbWUgdGhlIHNjb3BlIHdhcyBkZWNsYXJlZCBmb3IsIG9yIG51bGwgZm9yIHRoZSBhbGwtdHlwZXMgKHVzZXIpIHNjb3BlOiBvbmUgc2NvcGUgY292ZXJpbmcgZXZlcnkgcmVzb3VyY2UgdHlwZSB0aGlzIHJlc291cmNlIGF1dGhvcml6ZXMgZm9yIHRoZSBjYWxsZXIsIHNvIGEgc3luYyBhdXRob3JpemVzIG9uY2UgaG93ZXZlciBtYW55IHR5cGVzIGl0IHNlcnZlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBudWxsfSByZXNvdXJjZVR5cGVzIC0gRm9yIHRoZSBhbGwtdHlwZXMgc2NvcGUsIHRoZSByZXNvdXJjZSB0eXBlcyB0aGUgY2xpZW50IGNhbiBhcHBseS4gQSBjaGVhcCBkZWxpdmVyeS90eXBlIGZpbHRlciBvbmx5IC0gaXQgbmFycm93cywgbmV2ZXIgd2lkZW5zLCB3aGF0IHRoZSBhcHAncyBhdXRob3JpemF0aW9uIGFscmVhZHkgYWxsb3dzLiBOdWxsIGZvciBhIHR5cGUtZGVjbGFyZWQgc2NvcGUuXG4gKi9cblxuLyoqXG4gKiBPbmUgcHVibGlzaGVkIHN5bmMgZW50cnkgYXMgZGVsaXZlcmVkIHRvIHRoZSBwZXItZGVsaXZlcnkgYWNjZXNzIHJlLWNoZWNrXG4gKiAoe0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UjY2hhbmdlRGVsaXZlcmFibGV9KTogdGhlIGNvbXBsZXRlIGJyb2FkY2FzdCBzeW5jXG4gKiBlbnRyeSDigJQgaW5jbHVkaW5nIHRoZSBpbW11dGFibGUgc3luYy1yb3cgaWQsIGFjdG9yLXNwZWNpZmljIG1ldGFkYXRhLCBhbmRcbiAqIGFueSBvdGhlciBhcHAgZmllbGRzIHRoZSBwdWJsaXNoZXIgcHV0IG9uIGl0IOKAlCB3aXRoIGByZXNvdXJjZUlkYCBhbmRcbiAqIGByZXNvdXJjZVR5cGVgIG5vcm1hbGl6ZWQgdG8gc3RyaW5ncy4gQXBwcyBhdXRob3JpemluZyBieSBleGFjdC1yb3dcbiAqIGlkZW50aXR5IHJlYWQgdGhlIGV4dHJhIGZpZWxkczsgb3ZlcnJpZGVzIHRoYXQgb25seSByZWFkXG4gKiBgcmVzb3VyY2VJZGAvYHJlc291cmNlVHlwZWAga2VlcCB3b3JraW5nIHVuY2hhbmdlZC5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gJiB7cmVzb3VyY2VJZDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZ319IENoYW5nZURlbGl2ZXJhYmxlU3luY0VudHJ5XG4gKi9cbmNvbnN0IFFVSUNLX1NFQVJDSF9DT0xVTU4gPSBcInF1aWNrU2VhcmNoXCJcblxuLyoqXG4gKiBCYXNlIHJlc291cmNlIGZvciBWZWxvY2lvdXMgc3luYyBlbmRwb2ludHMuXG4gKlxuICogVmVsb2Npb3VzIG93bnMgdGhlIGNoYW5nZXMvcmVwbGF5IG9yY2hlc3RyYXRpb24gKHNjb3BlIHBhcnNpbmcsIGZlZWQgcGFnaW5nLFxuICogcmVwbGF5IGRlbGVnYXRpb24sIHJlc3BvbnNlIHNoYXBlKSB3aGlsZSBhcHBzIHN1YmNsYXNzIGFuZCBvbmx5IGRlY2xhcmVcbiAqIGF1dGhvcml6YXRpb24sIGZlZWQgc2NvcGluZywgYW5kIHRoZWlyIHJlcGxheSBzZXJ2aWNlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtUTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3M+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jUmVzb3VyY2VCYXNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gIC8qKlxuICAgKiBSZXBsYXkgc2VydmljZSBjbGFzcyBoYW5kbGluZyByZXBsYXkgbXV0YXRpb25zIGZvciB0aGlzIHJlc291cmNlLFxuICAgKiBkZWNsYXJlZCBpbnN0ZWFkIG9mIG92ZXJyaWRpbmcge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UjcmVwbGF5U2VydmljZUNsYXNzfS5cbiAgICogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH1cbiAgICovXG4gIHN0YXRpYyBSZXBsYXlTZXJ2aWNlQ2xhc3MgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVjbGFyYXRpdmUgcXVpY2stc2VhcmNoIHRleHQgY29sdW1ucy4gV2hlbiBkZWNsYXJlZCwgYW4gaW5kZXggc2VhcmNoIG9uXG4gICAqIHRoZSBwc2V1ZG8tY29sdW1uIGBxdWlja1NlYXJjaGAgZXhwYW5kcyB0byBhbiBPUiBvZiBMSUtFIGNvbmRpdGlvbnMgb3ZlclxuICAgKiB0aGVzZSByb290LXRhYmxlIGNvbHVtbnMgaW5zdGVhZCBvZiBoaXR0aW5nIHRoZSBjb250cm9sbGVyIGRlZmF1bHQuXG4gICAqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGx9ICovXG4gIHN0YXRpYyBxdWlja1NlYXJjaENvbHVtbnMgPSBudWxsXG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc2VhcmNoZXMsIGV4cGFuZGluZyBkZWNsYXJlZCBxdWljayBzZWFyY2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoKHtjb250cm9sbGVyLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGlmICh0aGlzLmFwcGx5UXVpY2tTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KSkgcmV0dXJuXG5cbiAgICBzdXBlci5hcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pXG4gIH1cblxuICAvKipcbiAgICogRXhwYW5kcyBhIGBxdWlja1NlYXJjaGAgcHNldWRvLWNvbHVtbiBzZWFyY2ggaW50byBhbiBPUiBvZiBMSUtFIGNvbmRpdGlvbnNcbiAgICogb3ZlciB0aGUgZGVjbGFyZWQge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UucXVpY2tTZWFyY2hDb2x1bW5zfS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgc2VhcmNoIHdhcyBoYW5kbGVkIGFzIGEgcXVpY2sgc2VhcmNoLlxuICAgKi9cbiAgYXBwbHlRdWlja1NlYXJjaCh7cXVlcnksIHNlYXJjaH0pIHtcbiAgICBjb25zdCBxdWlja1NlYXJjaENvbHVtbnMgPSAvKiogQHR5cGUge3R5cGVvZiBTeW5jUmVzb3VyY2VCYXNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcikucXVpY2tTZWFyY2hDb2x1bW5zXG5cbiAgICBpZiAoIXF1aWNrU2VhcmNoQ29sdW1ucyB8fCBxdWlja1NlYXJjaENvbHVtbnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoc2VhcmNoLnBhdGgubGVuZ3RoID4gMCB8fCBzZWFyY2guY29sdW1uICE9PSBRVUlDS19TRUFSQ0hfQ09MVU1OKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgIT09IFwibGlrZVwiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiU3luYyBxdWljayBzZWFyY2ggbXVzdCB1c2UgdGhlIGxpa2Ugb3BlcmF0b3IuXCIsIHtjb2RlOiBcInN5bmMtaW52YWxpZC1xdWljay1zZWFyY2hcIn0pXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBzZWFyY2gudmFsdWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJTeW5jIHF1aWNrIHNlYXJjaCBtdXN0IGJlIGEgc3RyaW5nLlwiLCB7Y29kZTogXCJzeW5jLWludmFsaWQtcXVpY2stc2VhcmNoXCJ9KVxuICAgIH1cblxuICAgIGNvbnN0IHRyaW1tZWRWYWx1ZSA9IHNlYXJjaC52YWx1ZS50cmltKClcblxuICAgIGlmICghdHJpbW1lZFZhbHVlKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgdGFibGVTcWwgPSBxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKSlcbiAgICBjb25zdCBsaWtlVmFsdWUgPSBgJSR7dHJpbW1lZFZhbHVlfSVgXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHF1aWNrU2VhcmNoQ29sdW1ucy5tYXAoKGNvbHVtbk5hbWUpID0+IChcbiAgICAgIGAke3RhYmxlU3FsfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX0gTElLRSAke3F1ZXJ5LmRyaXZlci5xdW90ZShsaWtlVmFsdWUpfWBcbiAgICApKVxuXG4gICAgcXVlcnkud2hlcmUoYCgke2NvbmRpdGlvbnMuam9pbihcIiBPUiBcIil9KWApXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLy8gVGhlIGRlY2xhcmF0aXZlIGBzdGF0aWMgd3JpdGFibGVBdHRyaWJ1dGVzYCBwZXJtaXQgbGlzdCBsaXZlcyBvblxuICAvLyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHNvIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGNhbiBkZWNsYXJlXG4gIC8vIG9uZTsgc3luYyByZXNvdXJjZXMgaW5oZXJpdCBpdCB1bmNoYW5nZWQuXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBzdGFibGUgY2hhbmdlLWZlZWQgcGFnZSBhZnRlciBhcHAgYXV0aG9yaXphdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQ2hhbmdlLWZlZWQgcGFnZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjaGFuZ2VzKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMucGFyYW1zKClcbiAgICBjb25zdCBzY29wZSA9IHRoaXMuY2hhbmdlc1Njb3BlKHBhcmFtcylcblxuICAgIGF3YWl0IHRoaXMuYXV0aG9yaXplQ2hhbmdlcyh7cGFyYW1zLCBzY29wZX0pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jaGFuZ2VGZWVkU2VydmljZSh7cGFyYW1zLCBzY29wZX0pLmNoYW5nZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgY2xpZW50IHN5bmMgZW52ZWxvcGVzIHRocm91Z2ggdGhlIGFwcCByZXBsYXkgc2VydmljZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gUmVwbGF5IHJlc3VsdCB3aXRoIHBlci1zeW5jIHN0YXRlcy5cbiAgICovXG4gIGFzeW5jIHJlcGxheSgpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5U2VydmljZSgpLnJlcGxheSh0aGlzLnBhcmFtcygpKVxuXG4gICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09IFwiZXJyb3JcIikgcmV0dXJuIHJlc3VsdFxuXG4gICAgcmV0dXJuIHtzdGF0dXM6IFwic3VjY2Vzc1wiLCBzeW5jczogcmVzdWx0LnN5bmNzfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyB0aGUgb3B0aW9uYWwgY2xpZW50LWRlY2xhcmVkIHNjb3BlIGZyb20gcmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1NlcmlhbGl6ZWRDaGFuZ2VzU2NvcGUgfCBudWxsfSBQYXJzZWQgc2NvcGUsIG9yIG51bGwgd2hlbiB0aGUgY2xpZW50IHNlbnQgbm9uZS5cbiAgICovXG4gIGNoYW5nZXNTY29wZShwYXJhbXMpIHtcbiAgICBjb25zdCBzY29wZSA9IHBhcmFtcy5zY29wZVxuXG4gICAgaWYgKHNjb3BlID09PSB1bmRlZmluZWQgfHwgc2NvcGUgPT09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBpZiAodHlwZW9mIHNjb3BlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2NvcGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY2hhbmdlcyBzY29wZSBtdXN0IGJlIGFuIG9iamVjdCwgZ290OiAke1N0cmluZyhzY29wZSl9YClcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZVBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2NvcGUpXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc2NvcGVQYXJhbXMucmVzb3VyY2VUeXBlID09PSBudWxsIHx8IHNjb3BlUGFyYW1zLnJlc291cmNlVHlwZSA9PT0gdW5kZWZpbmVkXG4gICAgICA/IG51bGxcbiAgICAgIDogZm9yY2VkTm9uQmxhbmtTdHJpbmcoc2NvcGVQYXJhbXMucmVzb3VyY2VUeXBlLCBcInJlc291cmNlVHlwZVwiKVxuICAgIGNvbnN0IHJlc291cmNlVHlwZXMgPSB0aGlzLmNoYW5nZXNTY29wZVJlc291cmNlVHlwZXMoc2NvcGVQYXJhbXMucmVzb3VyY2VUeXBlcylcbiAgICBjb25zdCBjb25kaXRpb25zID0gc2NvcGVQYXJhbXMuY29uZGl0aW9uc1xuXG4gICAgaWYgKCFjb25kaXRpb25zIHx8IHR5cGVvZiBjb25kaXRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjaGFuZ2VzIHNjb3BlLmNvbmRpdGlvbnMgbXVzdCBiZSBhbiBvYmplY3QsIGdvdDogJHtTdHJpbmcoY29uZGl0aW9ucyl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge2NvbmRpdGlvbnM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY29uZGl0aW9ucyksIHJlc291cmNlVHlwZSwgcmVzb3VyY2VUeXBlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgdGhlIG9wdGlvbmFsIHJlc291cmNlLXR5cGUgbGlzdCBhbiBhbGwtdHlwZXMgc2NvcGUgZGVjbGFyZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IGBzY29wZS5yZXNvdXJjZVR5cGVzYCBwYXJhbS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gRGVjbGFyZWQgcmVzb3VyY2UgdHlwZXMsIG9yIG51bGwgd2hlbiB0aGUgY2xpZW50IHNlbnQgbm9uZS5cbiAgICovXG4gIGNoYW5nZXNTY29wZVJlc291cmNlVHlwZXModmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgU3luYyBjaGFuZ2VzIHNjb3BlLnJlc291cmNlVHlwZXMgbXVzdCBiZSBhbiBhcnJheSwgZ290OiAke1N0cmluZyh2YWx1ZSl9YClcblxuICAgIHJldHVybiB2YWx1ZS5tYXAoKHJlc291cmNlVHlwZSkgPT4gZm9yY2VkTm9uQmxhbmtTdHJpbmcocmVzb3VyY2VUeXBlLCBcInJlc291cmNlVHlwZXNcIikpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBjaGFuZ2UtZmVlZCBzZXJ2aWNlIHNlcnZpbmcgdGhpcyBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7e3BhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzY29wZTogU2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGx9fSBhcmdzIC0gUmVxdWVzdCBwYXJhbXMgYW5kIHBhcnNlZCBzY29wZS5cbiAgICogQHJldHVybnMge3tjaGFuZ2VzOiAoKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59fSBDaGFuZ2UtZmVlZCBzZXJ2aWNlLlxuICAgKi9cbiAgY2hhbmdlRmVlZFNlcnZpY2Uoe3BhcmFtcywgc2NvcGV9KSB7XG4gICAgcmV0dXJuIG5ldyBTeW5jTW9kZWxDaGFuZ2VGZWVkU2VydmljZSh7XG4gICAgICBtb2RlbENsYXNzOiB0aGlzLnN5bmNNb2RlbENsYXNzKCksXG4gICAgICBwYXJhbXMsXG4gICAgICBzY29wZVF1ZXJ5OiAoe3F1ZXJ5fSkgPT4gdGhpcy5zY29wZUNoYW5nZXNRdWVyeSh7cGFyYW1zLCBxdWVyeSwgc2NvcGV9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBhcHAgcmVwbGF5IHNlcnZpY2UgaGFuZGxpbmcgdGhpcyByZXBsYXkgcmVxdWVzdC4gVGhlIHJlc291cmNlXG4gICAqIGFiaWxpdHksIGNvbnRleHQsIGNvbmZpZ3VyYXRpb24sIGFuZCBsb2NhbHMgYXJlIHBsdW1iZWQgaW4gdW5kZXIgdGhlXG4gICAqIGFwcC1kZWNsYXJlZCB7QGxpbmsgU3luY1Jlc291cmNlQmFzZSNyZXBsYXlTZXJ2aWNlQXJnc30gKGFwcCBhcmdzIHdpbikgc29cbiAgICogdGhlIGRlZmF1bHQgcmVzb3VyY2Utcm91dGVkIHJlcGxheSB3b3JrcyB3aXRob3V0IHdpcmluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5kZWZhdWx0fSBSZXBsYXkgc2VydmljZSBpbnN0YW5jZS5cbiAgICovXG4gIGJ1aWxkUmVwbGF5U2VydmljZSgpIHtcbiAgICBjb25zdCBSZXBsYXlTZXJ2aWNlQ2xhc3MgPSB0aGlzLnJlcGxheVNlcnZpY2VDbGFzcygpXG5cbiAgICByZXR1cm4gbmV3IFJlcGxheVNlcnZpY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBhYmlsaXR5Q29udGV4dDogdGhpcy5nZXRDb250ZXh0KCksXG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbnRyb2xsZXIgPyB0aGlzLmNvbnRyb2xsZXJJbnN0YW5jZSgpLmdldENvbmZpZ3VyYXRpb24oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGxvY2FsczogdGhpcy5nZXRMb2NhbHMoKSxcbiAgICAgIC4uLnRoaXMucmVwbGF5U2VydmljZUFyZ3MoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjb25zdHJ1Y3RvciBhcmdzIGZvciB0aGUgYXBwIHJlcGxheSBzZXJ2aWNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBSZXBsYXkgc2VydmljZSBjb25zdHJ1Y3RvciBhcmdzLlxuICAgKi9cbiAgcmVwbGF5U2VydmljZUFyZ3MoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc3luYyBtb2RlbCBjbGFzcyBiYWNraW5nIHRoZSBjaGFuZ2UgZmVlZC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gU3luYyBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN5bmNNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBTeW5jUmVzb3VyY2VCYXNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcikuTW9kZWxDbGFzc1xuXG4gICAgaWYgKCFtb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSBtdXN0IGRlZmluZSBzdGF0aWMgTW9kZWxDbGFzc2ApXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNoYXJlZCB1cHN0cmVhbSBpbXBvcnRlciBmb3IgdGhpcyByZXNvdXJjZSdzIGNvbmZpZ3VyYXRpb24uIEFwcHNcbiAgICogdXNlIGl0IGluc2lkZSB7QGxpbmsgU3luY1Jlc291cmNlQmFzZSNhdXRob3JpemVDaGFuZ2VzfSAob3IgYSBsZWdhY3kgdHJpZ2dlclxuICAgKiBlbmRwb2ludCkgdG8gcnVuIHRoZSB1cHN0cmVhbSBpbXBvcnQgdGhhdCBrZWVwcyB0aGUgZmVlZCBzZWxmLXN1c3RhaW5pbmcsXG4gICAqIHdpdGggY29hbGVzY2luZyBhbmQgdGhyb3R0bGluZyBvd25lZCBieSB0aGUgZnJhbWV3b3JrLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLXVwc3RyZWFtLWltcG9ydGVyLmpzXCIpLmRlZmF1bHR9IFNoYXJlZCBpbXBvcnRlciBmb3IgdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN5bmNVcHN0cmVhbUltcG9ydGVyKCkge1xuICAgIHJldHVybiBzeW5jVXBzdHJlYW1JbXBvcnRlckZvckNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKCkpXG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyB0aGUgY3VycmVudCBjb250ZXh0IGZvciByZWFkaW5nIHRoZSByZXF1ZXN0ZWQgY2hhbmdlcy5cbiAgICogQHBhcmFtIHt7cGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNjb3BlOiBTZXJpYWxpemVkQ2hhbmdlc1Njb3BlIHwgbnVsbH19IF9hcmdzIC0gUmVxdWVzdCBwYXJhbXMgYW5kIHBhcnNlZCBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gYWNjZXNzIGlzIGFsbG93ZWQ7IHRocm93cyBvdGhlcndpc2UuXG4gICAqL1xuICBhc3luYyBhdXRob3JpemVDaGFuZ2VzKF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1Jlc291cmNlQmFzZSNhdXRob3JpemVDaGFuZ2VzIG11c3QgYmUgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGFwcCB2aXNpYmlsaXR5IHNjb3Bpbmcgb250byB0aGUgY2hhbmdlLWZlZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7e3BhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCwgc2NvcGU6IFNlcmlhbGl6ZWRDaGFuZ2VzU2NvcGUgfCBudWxsfX0gX2FyZ3MgLSBSZXF1ZXN0IHBhcmFtcywgZmVlZCBxdWVyeSwgYW5kIHBhcnNlZCBzY29wZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY29wZUNoYW5nZXNRdWVyeShfYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNSZXNvdXJjZUJhc2Ujc2NvcGVDaGFuZ2VzUXVlcnkgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2lkZXMgd2hldGhlciBvbmUgcHVibGlzaGVkIGNoYW5nZSBpcyBkZWxpdmVyYWJsZSB0byBhIHVzZXItc2NvcGVcbiAgICogc3Vic2NyaXB0aW9uICh0aGUgZnJhbWV3b3JrIHN5bmMgY2hhbm5lbCdzIHBlci1kZWxpdmVyeSBhY2Nlc3MgcmUtY2hlY2spLlxuICAgKiBUaGUgZGVmYXVsdCByZXVzZXMgdGhlIGFwcCdzIGFiaWxpdHkgc2NvcGluZzogaXQgYXBwbGllc1xuICAgKiB7QGxpbmsgU3luY1Jlc291cmNlQmFzZSNzY29wZUNoYW5nZXNRdWVyeX0gdG8gdGhlIGNoYW5nZS1mZWVkIG1vZGVsIOKAlCB3aGljaFxuICAgKiBmb3IgYW4gZW1wdHktY29uZGl0aW9ucyB1c2VyIHNjb3BlIGZhbGxzIGJhY2sgdG8gYWJpbGl0eSBzY29waW5nIOKAlCBhbmRcbiAgICogY2hlY2tzIHdoZXRoZXIgdGhlIHB1Ymxpc2hlZCBjaGFuZ2UncyBmZWVkIHJvdyBpcyB2aXNpYmxlIHdpdGhpbiB0aGF0XG4gICAqIHNjb3BlLiBBcHBzIGdldCB0aGlzIGZvciBmcmVlIGZyb20gdGhlIHNjb3BpbmcgdGhleSBhbHJlYWR5IGRlY2xhcmVkO1xuICAgKiBvdmVycmlkZSBvbmx5IGZvciBjdXN0b20gcGVyLWRlbGl2ZXJ5IHJ1bGVzLlxuICAgKlxuICAgKiBUaGUgYHN5bmNgIGFyZ3VtZW50IGlzIHRoZSBjb21wbGV0ZSBicm9hZGNhc3Qgc3luYyBlbnRyeSDigJQgaW1tdXRhYmxlXG4gICAqIHN5bmMtcm93IGlkLCBhY3Rvci1zcGVjaWZpYyBtZXRhZGF0YSwgYW5kIGFueSBvdGhlciBwdWJsaXNoZXIgZmllbGRzIOKAlFxuICAgKiB3aXRoIGByZXNvdXJjZUlkYC9gcmVzb3VyY2VUeXBlYCBub3JtYWxpemVkIHRvIHN0cmluZ3MsIHNvIGFuIG92ZXJyaWRlXG4gICAqIGNhbiBhdXRob3JpemUgY29uY3VycmVudCB0YXJnZXRlZCBhbmQgc2hhcmVkIGJyb2FkY2FzdHMgZm9yIHRoZSBzYW1lXG4gICAqIHJlc291cmNlIGlkZW50aXR5IGluZGVwZW5kZW50bHkgYnkgdGhlaXIgZXhhY3Qtcm93IGlkZW50aXR5LiBUaGUgY2hhbm5lbFxuICAgKiBuZXZlciBtdXRhdGVzIHRoZSBwdWJsaXNoZWQgZW50cnk7IG5vcm1hbGl6YXRpb24gaGFwcGVucyBvbiBhIGNvcHkuXG4gICAqIEBwYXJhbSB7e3BhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzY29wZTogU2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGwsIHN5bmM6IENoYW5nZURlbGl2ZXJhYmxlU3luY0VudHJ5fX0gYXJncyAtIFJlcXVlc3QgcGFyYW1zLCBzdWJzY3JpcHRpb24gc2NvcGUsIGFuZCB0aGUgcHVibGlzaGVkIHN5bmMgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBjaGFuZ2UgbWF5IGJlIGRlbGl2ZXJlZCB0byB0aGlzIHN1YnNjcmlwdGlvbi5cbiAgICovXG4gIGFzeW5jIGNoYW5nZURlbGl2ZXJhYmxlKHtwYXJhbXMsIHNjb3BlLCBzeW5jfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5zeW5jTW9kZWxDbGFzcygpLndoZXJlKHt9KVxuXG4gICAgdGhpcy5zY29wZUNoYW5nZXNRdWVyeSh7cGFyYW1zLCBxdWVyeSwgc2NvcGV9KVxuICAgIHF1ZXJ5LndoZXJlKHtyZXNvdXJjZV9pZDogU3RyaW5nKHN5bmMucmVzb3VyY2VJZCksIHJlc291cmNlX3R5cGU6IFN0cmluZyhzeW5jLnJlc291cmNlVHlwZSl9KVxuXG4gICAgcmV0dXJuIEJvb2xlYW4oYXdhaXQgcXVlcnkuZmlyc3QoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcmVwbGF5IHNlcnZpY2UgY2xhc3MgaGFuZGxpbmcgcmVwbGF5IG11dGF0aW9uczogdGhlXG4gICAqIGRlY2xhcmF0aXZlIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlLlJlcGxheVNlcnZpY2VDbGFzc30gc3RhdGljIChzaGFyZWRcbiAgICogcmVzb3VyY2VzIGluY2x1ZGVkKSB3aGVuIGRlY2xhcmVkLCBvdGhlcndpc2VcbiAgICoge0BsaW5rIFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2V9LCB3aGljaCByZXNvdXJjZS1yb3V0ZXMgbXV0YXRpb25zIHRocm91Z2hcbiAgICogdGhlIHBsdW1iZWQgY29uZmlndXJhdGlvbiByZWdpc3RyeS4gQXBwcyBkZWNsYXJlIHRoZSBzdGF0aWMgaW5zdGVhZCBvZlxuICAgKiBvdmVycmlkaW5nIHRoaXMgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5kZWZhdWx0fSBSZXBsYXkgc2VydmljZSBjbGFzcy5cbiAgICovXG4gIHJlcGxheVNlcnZpY2VDbGFzcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgU3luY1Jlc291cmNlQmFzZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBTeW5jUmVzb3VyY2VCYXNlIHwgbnVsbH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpID8/IG51bGwpXG5cbiAgICByZXR1cm4gUmVzb3VyY2VDbGFzcy5SZXBsYXlTZXJ2aWNlQ2xhc3MgPz8gU2hhcmVkUmVzb3VyY2U/LlJlcGxheVNlcnZpY2VDbGFzcyA/PyBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlXG4gIH1cbn1cbiJdfQ==