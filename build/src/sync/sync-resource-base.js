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
    /** @type {typeof import("../database/record/index.js").default | undefined} */
    static ModelClass = undefined;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZXNvdXJjZS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1yZXNvdXJjZS1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsb0JBQW9CLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFFNUMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sMEJBQTBCLE1BQU0scUNBQXFDLENBQUE7QUFDNUUsT0FBTyxFQUFDLG9DQUFvQyxFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFDaEYsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFFbEQ7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxtQkFBbUIsR0FBRyxhQUFhLENBQUE7QUFFekM7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFpQixTQUFRLHlCQUF5QjtJQUNyRSwrRUFBK0U7SUFDL0UsTUFBTSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7SUFFN0I7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFFckM7Ozs7aUNBSTZCO0lBQzdCLE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUE7SUFFaEM7Ozs7Ozs7T0FPRztJQUNILDZCQUE2QixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUM7UUFDdkQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUM7WUFBRSxPQUFNO1FBRWxELEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtJQUNsRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNI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QTtJQUNyQyxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxrQkFBa0I7UUFDaEIsTUFBTSxhQUFhLEdBQUcsc0NBQXNDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDL0UsTUFBTSxjQUFjLEdBQUcsNkNBQTZDLENBQUMsQ0FBQyxhQUFhLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxJQUFJLENBQUMsQ0FBQTtRQUVsSCxPQUFPLGFBQWEsQ0FBQyxrQkFBa0IsSUFBSSxjQUFjLEVBQUUsa0JBQWtCLElBQUkseUJBQXlCLENBQUE7SUFDNUcsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Zm9yY2VkTm9uQmxhbmtTdHJpbmd9IGZyb20gXCJ0eXBhbmljXCJcblxuaW1wb3J0IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgZnJvbSBcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiXG5pbXBvcnQgU3luY01vZGVsQ2hhbmdlRmVlZFNlcnZpY2UgZnJvbSBcIi4vc3luYy1tb2RlbC1jaGFuZ2UtZmVlZC1zZXJ2aWNlLmpzXCJcbmltcG9ydCB7c3luY1Vwc3RyZWFtSW1wb3J0ZXJGb3JDb25maWd1cmF0aW9ufSBmcm9tIFwiLi9zeW5jLXVwc3RyZWFtLWltcG9ydGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBPcHRpb25hbCBjbGllbnQtZGVjbGFyZWQgc3luYyBzY29wZSBjYXJyaWVkIG9uIGEgY2hhbmdlcyByZXF1ZXN0LlxuICogQHR5cGVkZWYge29iamVjdH0gU2VyaWFsaXplZENoYW5nZXNTY29wZVxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBQbGFpbiBhdHRyaWJ1dGUgY29uZGl0aW9ucyBmcm9tIHRoZSBjbGllbnQgcXVlcnkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHJlc291cmNlVHlwZSAtIENsaWVudCByZXNvdXJjZS9tb2RlbCBuYW1lIHRoZSBzY29wZSB3YXMgZGVjbGFyZWQgZm9yLCBvciBudWxsIGZvciB0aGUgYWxsLXR5cGVzICh1c2VyKSBzY29wZTogb25lIHNjb3BlIGNvdmVyaW5nIGV2ZXJ5IHJlc291cmNlIHR5cGUgdGhpcyByZXNvdXJjZSBhdXRob3JpemVzIGZvciB0aGUgY2FsbGVyLCBzbyBhIHN5bmMgYXV0aG9yaXplcyBvbmNlIGhvd2V2ZXIgbWFueSB0eXBlcyBpdCBzZXJ2ZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdIHwgbnVsbH0gcmVzb3VyY2VUeXBlcyAtIEZvciB0aGUgYWxsLXR5cGVzIHNjb3BlLCB0aGUgcmVzb3VyY2UgdHlwZXMgdGhlIGNsaWVudCBjYW4gYXBwbHkuIEEgY2hlYXAgZGVsaXZlcnkvdHlwZSBmaWx0ZXIgb25seSAtIGl0IG5hcnJvd3MsIG5ldmVyIHdpZGVucywgd2hhdCB0aGUgYXBwJ3MgYXV0aG9yaXphdGlvbiBhbHJlYWR5IGFsbG93cy4gTnVsbCBmb3IgYSB0eXBlLWRlY2xhcmVkIHNjb3BlLlxuICovXG5cbi8qKlxuICogT25lIHB1Ymxpc2hlZCBzeW5jIGVudHJ5IGFzIGRlbGl2ZXJlZCB0byB0aGUgcGVyLWRlbGl2ZXJ5IGFjY2VzcyByZS1jaGVja1xuICogKHtAbGluayBTeW5jUmVzb3VyY2VCYXNlI2NoYW5nZURlbGl2ZXJhYmxlfSk6IHRoZSBjb21wbGV0ZSBicm9hZGNhc3Qgc3luY1xuICogZW50cnkg4oCUIGluY2x1ZGluZyB0aGUgaW1tdXRhYmxlIHN5bmMtcm93IGlkLCBhY3Rvci1zcGVjaWZpYyBtZXRhZGF0YSwgYW5kXG4gKiBhbnkgb3RoZXIgYXBwIGZpZWxkcyB0aGUgcHVibGlzaGVyIHB1dCBvbiBpdCDigJQgd2l0aCBgcmVzb3VyY2VJZGAgYW5kXG4gKiBgcmVzb3VyY2VUeXBlYCBub3JtYWxpemVkIHRvIHN0cmluZ3MuIEFwcHMgYXV0aG9yaXppbmcgYnkgZXhhY3Qtcm93XG4gKiBpZGVudGl0eSByZWFkIHRoZSBleHRyYSBmaWVsZHM7IG92ZXJyaWRlcyB0aGF0IG9ubHkgcmVhZFxuICogYHJlc291cmNlSWRgL2ByZXNvdXJjZVR5cGVgIGtlZXAgd29ya2luZyB1bmNoYW5nZWQuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+ICYge3Jlc291cmNlSWQ6IHN0cmluZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBDaGFuZ2VEZWxpdmVyYWJsZVN5bmNFbnRyeVxuICovXG5jb25zdCBRVUlDS19TRUFSQ0hfQ09MVU1OID0gXCJxdWlja1NlYXJjaFwiXG5cbi8qKlxuICogQmFzZSByZXNvdXJjZSBmb3IgVmVsb2Npb3VzIHN5bmMgZW5kcG9pbnRzLlxuICpcbiAqIFZlbG9jaW91cyBvd25zIHRoZSBjaGFuZ2VzL3JlcGxheSBvcmNoZXN0cmF0aW9uIChzY29wZSBwYXJzaW5nLCBmZWVkIHBhZ2luZyxcbiAqIHJlcGxheSBkZWxlZ2F0aW9uLCByZXNwb25zZSBzaGFwZSkgd2hpbGUgYXBwcyBzdWJjbGFzcyBhbmQgb25seSBkZWNsYXJlXG4gKiBhdXRob3JpemF0aW9uLCBmZWVkIHNjb3BpbmcsIGFuZCB0aGVpciByZXBsYXkgc2VydmljZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQGF1Z21lbnRzIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzPn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY1Jlc291cmNlQmFzZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIE1vZGVsQ2xhc3MgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUmVwbGF5IHNlcnZpY2UgY2xhc3MgaGFuZGxpbmcgcmVwbGF5IG11dGF0aW9ucyBmb3IgdGhpcyByZXNvdXJjZSxcbiAgICogZGVjbGFyZWQgaW5zdGVhZCBvZiBvdmVycmlkaW5nIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlI3JlcGxheVNlcnZpY2VDbGFzc30uXG4gICAqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgUmVwbGF5U2VydmljZUNsYXNzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHF1aWNrLXNlYXJjaCB0ZXh0IGNvbHVtbnMuIFdoZW4gZGVjbGFyZWQsIGFuIGluZGV4IHNlYXJjaCBvblxuICAgKiB0aGUgcHNldWRvLWNvbHVtbiBgcXVpY2tTZWFyY2hgIGV4cGFuZHMgdG8gYW4gT1Igb2YgTElLRSBjb25kaXRpb25zIG92ZXJcbiAgICogdGhlc2Ugcm9vdC10YWJsZSBjb2x1bW5zIGluc3RlYWQgb2YgaGl0dGluZyB0aGUgY29udHJvbGxlciBkZWZhdWx0LlxuICAgKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsfSAqL1xuICBzdGF0aWMgcXVpY2tTZWFyY2hDb2x1bW5zID0gbnVsbFxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNlYXJjaGVzLCBleHBhbmRpbmcgZGVjbGFyZWQgcXVpY2sgc2VhcmNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pIHtcbiAgICBpZiAodGhpcy5hcHBseVF1aWNrU2VhcmNoKHtxdWVyeSwgc2VhcmNofSkpIHJldHVyblxuXG4gICAgc3VwZXIuYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2goe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzZWFyY2h9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4cGFuZHMgYSBgcXVpY2tTZWFyY2hgIHBzZXVkby1jb2x1bW4gc2VhcmNoIGludG8gYW4gT1Igb2YgTElLRSBjb25kaXRpb25zXG4gICAqIG92ZXIgdGhlIGRlY2xhcmVkIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlLnF1aWNrU2VhcmNoQ29sdW1uc30uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IHRvIGZpbHRlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggcGF5bG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHNlYXJjaCB3YXMgaGFuZGxlZCBhcyBhIHF1aWNrIHNlYXJjaC5cbiAgICovXG4gIGFwcGx5UXVpY2tTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29uc3QgcXVpY2tTZWFyY2hDb2x1bW5zID0gLyoqIEB0eXBlIHt0eXBlb2YgU3luY1Jlc291cmNlQmFzZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpLnF1aWNrU2VhcmNoQ29sdW1uc1xuXG4gICAgaWYgKCFxdWlja1NlYXJjaENvbHVtbnMgfHwgcXVpY2tTZWFyY2hDb2x1bW5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHNlYXJjaC5wYXRoLmxlbmd0aCA+IDAgfHwgc2VhcmNoLmNvbHVtbiAhPT0gUVVJQ0tfU0VBUkNIX0NPTFVNTikgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoc2VhcmNoLm9wZXJhdG9yICE9PSBcImxpa2VcIikge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlN5bmMgcXVpY2sgc2VhcmNoIG11c3QgdXNlIHRoZSBsaWtlIG9wZXJhdG9yLlwiLCB7Y29kZTogXCJzeW5jLWludmFsaWQtcXVpY2stc2VhcmNoXCJ9KVxuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygc2VhcmNoLnZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiU3luYyBxdWljayBzZWFyY2ggbXVzdCBiZSBhIHN0cmluZy5cIiwge2NvZGU6IFwic3luYy1pbnZhbGlkLXF1aWNrLXNlYXJjaFwifSlcbiAgICB9XG5cbiAgICBjb25zdCB0cmltbWVkVmFsdWUgPSBzZWFyY2gudmFsdWUudHJpbSgpXG5cbiAgICBpZiAoIXRyaW1tZWRWYWx1ZSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHRhYmxlU3FsID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUocXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKCkpXG4gICAgY29uc3QgbGlrZVZhbHVlID0gYCUke3RyaW1tZWRWYWx1ZX0lYFxuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBxdWlja1NlYXJjaENvbHVtbnMubWFwKChjb2x1bW5OYW1lKSA9PiAoXG4gICAgICBgJHt0YWJsZVNxbH0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9IExJS0UgJHtxdWVyeS5kcml2ZXIucXVvdGUobGlrZVZhbHVlKX1gXG4gICAgKSlcblxuICAgIHF1ZXJ5LndoZXJlKGAoJHtjb25kaXRpb25zLmpvaW4oXCIgT1IgXCIpfSlgKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8vIFRoZSBkZWNsYXJhdGl2ZSBgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlc2AgcGVybWl0IGxpc3QgbGl2ZXMgb25cbiAgLy8gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzbyBldmVyeSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBjYW4gZGVjbGFyZVxuICAvLyBvbmU7IHN5bmMgcmVzb3VyY2VzIGluaGVyaXQgaXQgdW5jaGFuZ2VkLlxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgc3RhYmxlIGNoYW5nZS1mZWVkIHBhZ2UgYWZ0ZXIgYXBwIGF1dGhvcml6YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IENoYW5nZS1mZWVkIHBhZ2UgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2hhbmdlcygpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLnBhcmFtcygpXG4gICAgY29uc3Qgc2NvcGUgPSB0aGlzLmNoYW5nZXNTY29wZShwYXJhbXMpXG5cbiAgICBhd2FpdCB0aGlzLmF1dGhvcml6ZUNoYW5nZXMoe3BhcmFtcywgc2NvcGV9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2hhbmdlRmVlZFNlcnZpY2Uoe3BhcmFtcywgc2NvcGV9KS5jaGFuZ2VzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIGNsaWVudCBzeW5jIGVudmVsb3BlcyB0aHJvdWdoIHRoZSBhcHAgcmVwbGF5IHNlcnZpY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFJlcGxheSByZXN1bHQgd2l0aCBwZXItc3luYyBzdGF0ZXMuXG4gICAqL1xuICBhc3luYyByZXBsYXkoKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5idWlsZFJlcGxheVNlcnZpY2UoKS5yZXBsYXkodGhpcy5wYXJhbXMoKSlcblxuICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSBcImVycm9yXCIpIHJldHVybiByZXN1bHRcblxuICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIiwgc3luY3M6IHJlc3VsdC5zeW5jc31cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgdGhlIG9wdGlvbmFsIGNsaWVudC1kZWNsYXJlZCBzY29wZSBmcm9tIHJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtTZXJpYWxpemVkQ2hhbmdlc1Njb3BlIHwgbnVsbH0gUGFyc2VkIHNjb3BlLCBvciBudWxsIHdoZW4gdGhlIGNsaWVudCBzZW50IG5vbmUuXG4gICAqL1xuICBjaGFuZ2VzU2NvcGUocGFyYW1zKSB7XG4gICAgY29uc3Qgc2NvcGUgPSBwYXJhbXMuc2NvcGVcblxuICAgIGlmIChzY29wZSA9PT0gdW5kZWZpbmVkIHx8IHNjb3BlID09PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHR5cGVvZiBzY29wZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNjb3BlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNoYW5nZXMgc2NvcGUgbXVzdCBiZSBhbiBvYmplY3QsIGdvdDogJHtTdHJpbmcoc2NvcGUpfWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVQYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNjb3BlKVxuICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IHNjb3BlUGFyYW1zLnJlc291cmNlVHlwZSA9PT0gbnVsbCB8fCBzY29wZVBhcmFtcy5yZXNvdXJjZVR5cGUgPT09IHVuZGVmaW5lZFxuICAgICAgPyBudWxsXG4gICAgICA6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKHNjb3BlUGFyYW1zLnJlc291cmNlVHlwZSwgXCJyZXNvdXJjZVR5cGVcIilcbiAgICBjb25zdCByZXNvdXJjZVR5cGVzID0gdGhpcy5jaGFuZ2VzU2NvcGVSZXNvdXJjZVR5cGVzKHNjb3BlUGFyYW1zLnJlc291cmNlVHlwZXMpXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHNjb3BlUGFyYW1zLmNvbmRpdGlvbnNcblxuICAgIGlmICghY29uZGl0aW9ucyB8fCB0eXBlb2YgY29uZGl0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY2hhbmdlcyBzY29wZS5jb25kaXRpb25zIG11c3QgYmUgYW4gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKGNvbmRpdGlvbnMpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb25kaXRpb25zOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNvbmRpdGlvbnMpLCByZXNvdXJjZVR5cGUsIHJlc291cmNlVHlwZXN9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHRoZSBvcHRpb25hbCByZXNvdXJjZS10eXBlIGxpc3QgYW4gYWxsLXR5cGVzIHNjb3BlIGRlY2xhcmVzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFJhdyBgc2NvcGUucmVzb3VyY2VUeXBlc2AgcGFyYW0uXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IERlY2xhcmVkIHJlc291cmNlIHR5cGVzLCBvciBudWxsIHdoZW4gdGhlIGNsaWVudCBzZW50IG5vbmUuXG4gICAqL1xuICBjaGFuZ2VzU2NvcGVSZXNvdXJjZVR5cGVzKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgY2hhbmdlcyBzY29wZS5yZXNvdXJjZVR5cGVzIG11c3QgYmUgYW4gYXJyYXksIGdvdDogJHtTdHJpbmcodmFsdWUpfWApXG5cbiAgICByZXR1cm4gdmFsdWUubWFwKChyZXNvdXJjZVR5cGUpID0+IGZvcmNlZE5vbkJsYW5rU3RyaW5nKHJlc291cmNlVHlwZSwgXCJyZXNvdXJjZVR5cGVzXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgY2hhbmdlLWZlZWQgc2VydmljZSBzZXJ2aW5nIHRoaXMgY2hhbmdlcyByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3twYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2NvcGU6IFNlcmlhbGl6ZWRDaGFuZ2VzU2NvcGUgfCBudWxsfX0gYXJncyAtIFJlcXVlc3QgcGFyYW1zIGFuZCBwYXJzZWQgc2NvcGUuXG4gICAqIEByZXR1cm5zIHt7Y2hhbmdlczogKCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fX0gQ2hhbmdlLWZlZWQgc2VydmljZS5cbiAgICovXG4gIGNoYW5nZUZlZWRTZXJ2aWNlKHtwYXJhbXMsIHNjb3BlfSkge1xuICAgIHJldHVybiBuZXcgU3luY01vZGVsQ2hhbmdlRmVlZFNlcnZpY2Uoe1xuICAgICAgbW9kZWxDbGFzczogdGhpcy5zeW5jTW9kZWxDbGFzcygpLFxuICAgICAgcGFyYW1zLFxuICAgICAgc2NvcGVRdWVyeTogKHtxdWVyeX0pID0+IHRoaXMuc2NvcGVDaGFuZ2VzUXVlcnkoe3BhcmFtcywgcXVlcnksIHNjb3BlfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXBwIHJlcGxheSBzZXJ2aWNlIGhhbmRsaW5nIHRoaXMgcmVwbGF5IHJlcXVlc3QuIFRoZSByZXNvdXJjZVxuICAgKiBhYmlsaXR5LCBjb250ZXh0LCBjb25maWd1cmF0aW9uLCBhbmQgbG9jYWxzIGFyZSBwbHVtYmVkIGluIHVuZGVyIHRoZVxuICAgKiBhcHAtZGVjbGFyZWQge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UjcmVwbGF5U2VydmljZUFyZ3N9IChhcHAgYXJncyB3aW4pIHNvXG4gICAqIHRoZSBkZWZhdWx0IHJlc291cmNlLXJvdXRlZCByZXBsYXkgd29ya3Mgd2l0aG91dCB3aXJpbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuZGVmYXVsdH0gUmVwbGF5IHNlcnZpY2UgaW5zdGFuY2UuXG4gICAqL1xuICBidWlsZFJlcGxheVNlcnZpY2UoKSB7XG4gICAgY29uc3QgUmVwbGF5U2VydmljZUNsYXNzID0gdGhpcy5yZXBsYXlTZXJ2aWNlQ2xhc3MoKVxuXG4gICAgcmV0dXJuIG5ldyBSZXBsYXlTZXJ2aWNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgYWJpbGl0eUNvbnRleHQ6IHRoaXMuZ2V0Q29udGV4dCgpLFxuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb250cm9sbGVyID8gdGhpcy5jb250cm9sbGVySW5zdGFuY2UoKS5nZXRDb25maWd1cmF0aW9uKCkgOiB1bmRlZmluZWQsXG4gICAgICBsb2NhbHM6IHRoaXMuZ2V0TG9jYWxzKCksXG4gICAgICAuLi50aGlzLnJlcGxheVNlcnZpY2VBcmdzKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgY29uc3RydWN0b3IgYXJncyBmb3IgdGhlIGFwcCByZXBsYXkgc2VydmljZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUmVwbGF5IHNlcnZpY2UgY29uc3RydWN0b3IgYXJncy5cbiAgICovXG4gIHJlcGxheVNlcnZpY2VBcmdzKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHN5bmMgbW9kZWwgY2xhc3MgYmFja2luZyB0aGUgY2hhbmdlIGZlZWQuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzeW5jTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgU3luY1Jlc291cmNlQmFzZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpLk1vZGVsQ2xhc3NcblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gbXVzdCBkZWZpbmUgc3RhdGljIE1vZGVsQ2xhc3NgKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzaGFyZWQgdXBzdHJlYW0gaW1wb3J0ZXIgZm9yIHRoaXMgcmVzb3VyY2UncyBjb25maWd1cmF0aW9uLiBBcHBzXG4gICAqIHVzZSBpdCBpbnNpZGUge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UjYXV0aG9yaXplQ2hhbmdlc30gKG9yIGEgbGVnYWN5IHRyaWdnZXJcbiAgICogZW5kcG9pbnQpIHRvIHJ1biB0aGUgdXBzdHJlYW0gaW1wb3J0IHRoYXQga2VlcHMgdGhlIGZlZWQgc2VsZi1zdXN0YWluaW5nLFxuICAgKiB3aXRoIGNvYWxlc2NpbmcgYW5kIHRocm90dGxpbmcgb3duZWQgYnkgdGhlIGZyYW1ld29yay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3luYy11cHN0cmVhbS1pbXBvcnRlci5qc1wiKS5kZWZhdWx0fSBTaGFyZWQgaW1wb3J0ZXIgZm9yIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzeW5jVXBzdHJlYW1JbXBvcnRlcigpIHtcbiAgICByZXR1cm4gc3luY1Vwc3RyZWFtSW1wb3J0ZXJGb3JDb25maWd1cmF0aW9uKHRoaXMuY29uZmlndXJhdGlvbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgdGhlIGN1cnJlbnQgY29udGV4dCBmb3IgcmVhZGluZyB0aGUgcmVxdWVzdGVkIGNoYW5nZXMuXG4gICAqIEBwYXJhbSB7e3BhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzY29wZTogU2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGx9fSBfYXJncyAtIFJlcXVlc3QgcGFyYW1zIGFuZCBwYXJzZWQgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIGFjY2VzcyBpcyBhbGxvd2VkOyB0aHJvd3Mgb3RoZXJ3aXNlLlxuICAgKi9cbiAgYXN5bmMgYXV0aG9yaXplQ2hhbmdlcyhfYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNSZXNvdXJjZUJhc2UjYXV0aG9yaXplQ2hhbmdlcyBtdXN0IGJlIGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhcHAgdmlzaWJpbGl0eSBzY29waW5nIG9udG8gdGhlIGNoYW5nZS1mZWVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3twYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQsIHNjb3BlOiBTZXJpYWxpemVkQ2hhbmdlc1Njb3BlIHwgbnVsbH19IF9hcmdzIC0gUmVxdWVzdCBwYXJhbXMsIGZlZWQgcXVlcnksIGFuZCBwYXJzZWQgc2NvcGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2NvcGVDaGFuZ2VzUXVlcnkoX2FyZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUmVzb3VyY2VCYXNlI3Njb3BlQ2hhbmdlc1F1ZXJ5IG11c3QgYmUgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNpZGVzIHdoZXRoZXIgb25lIHB1Ymxpc2hlZCBjaGFuZ2UgaXMgZGVsaXZlcmFibGUgdG8gYSB1c2VyLXNjb3BlXG4gICAqIHN1YnNjcmlwdGlvbiAodGhlIGZyYW1ld29yayBzeW5jIGNoYW5uZWwncyBwZXItZGVsaXZlcnkgYWNjZXNzIHJlLWNoZWNrKS5cbiAgICogVGhlIGRlZmF1bHQgcmV1c2VzIHRoZSBhcHAncyBhYmlsaXR5IHNjb3Bpbmc6IGl0IGFwcGxpZXNcbiAgICoge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2Ujc2NvcGVDaGFuZ2VzUXVlcnl9IHRvIHRoZSBjaGFuZ2UtZmVlZCBtb2RlbCDigJQgd2hpY2hcbiAgICogZm9yIGFuIGVtcHR5LWNvbmRpdGlvbnMgdXNlciBzY29wZSBmYWxscyBiYWNrIHRvIGFiaWxpdHkgc2NvcGluZyDigJQgYW5kXG4gICAqIGNoZWNrcyB3aGV0aGVyIHRoZSBwdWJsaXNoZWQgY2hhbmdlJ3MgZmVlZCByb3cgaXMgdmlzaWJsZSB3aXRoaW4gdGhhdFxuICAgKiBzY29wZS4gQXBwcyBnZXQgdGhpcyBmb3IgZnJlZSBmcm9tIHRoZSBzY29waW5nIHRoZXkgYWxyZWFkeSBkZWNsYXJlZDtcbiAgICogb3ZlcnJpZGUgb25seSBmb3IgY3VzdG9tIHBlci1kZWxpdmVyeSBydWxlcy5cbiAgICpcbiAgICogVGhlIGBzeW5jYCBhcmd1bWVudCBpcyB0aGUgY29tcGxldGUgYnJvYWRjYXN0IHN5bmMgZW50cnkg4oCUIGltbXV0YWJsZVxuICAgKiBzeW5jLXJvdyBpZCwgYWN0b3Itc3BlY2lmaWMgbWV0YWRhdGEsIGFuZCBhbnkgb3RoZXIgcHVibGlzaGVyIGZpZWxkcyDigJRcbiAgICogd2l0aCBgcmVzb3VyY2VJZGAvYHJlc291cmNlVHlwZWAgbm9ybWFsaXplZCB0byBzdHJpbmdzLCBzbyBhbiBvdmVycmlkZVxuICAgKiBjYW4gYXV0aG9yaXplIGNvbmN1cnJlbnQgdGFyZ2V0ZWQgYW5kIHNoYXJlZCBicm9hZGNhc3RzIGZvciB0aGUgc2FtZVxuICAgKiByZXNvdXJjZSBpZGVudGl0eSBpbmRlcGVuZGVudGx5IGJ5IHRoZWlyIGV4YWN0LXJvdyBpZGVudGl0eS4gVGhlIGNoYW5uZWxcbiAgICogbmV2ZXIgbXV0YXRlcyB0aGUgcHVibGlzaGVkIGVudHJ5OyBub3JtYWxpemF0aW9uIGhhcHBlbnMgb24gYSBjb3B5LlxuICAgKiBAcGFyYW0ge3twYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2NvcGU6IFNlcmlhbGl6ZWRDaGFuZ2VzU2NvcGUgfCBudWxsLCBzeW5jOiBDaGFuZ2VEZWxpdmVyYWJsZVN5bmNFbnRyeX19IGFyZ3MgLSBSZXF1ZXN0IHBhcmFtcywgc3Vic2NyaXB0aW9uIHNjb3BlLCBhbmQgdGhlIHB1Ymxpc2hlZCBzeW5jIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgY2hhbmdlIG1heSBiZSBkZWxpdmVyZWQgdG8gdGhpcyBzdWJzY3JpcHRpb24uXG4gICAqL1xuICBhc3luYyBjaGFuZ2VEZWxpdmVyYWJsZSh7cGFyYW1zLCBzY29wZSwgc3luY30pIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuc3luY01vZGVsQ2xhc3MoKS53aGVyZSh7fSlcblxuICAgIHRoaXMuc2NvcGVDaGFuZ2VzUXVlcnkoe3BhcmFtcywgcXVlcnksIHNjb3BlfSlcbiAgICBxdWVyeS53aGVyZSh7cmVzb3VyY2VfaWQ6IFN0cmluZyhzeW5jLnJlc291cmNlSWQpLCByZXNvdXJjZV90eXBlOiBTdHJpbmcoc3luYy5yZXNvdXJjZVR5cGUpfSlcblxuICAgIHJldHVybiBCb29sZWFuKGF3YWl0IHF1ZXJ5LmZpcnN0KCkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJlcGxheSBzZXJ2aWNlIGNsYXNzIGhhbmRsaW5nIHJlcGxheSBtdXRhdGlvbnM6IHRoZVxuICAgKiBkZWNsYXJhdGl2ZSB7QGxpbmsgU3luY1Jlc291cmNlQmFzZS5SZXBsYXlTZXJ2aWNlQ2xhc3N9IHN0YXRpYyAoc2hhcmVkXG4gICAqIHJlc291cmNlcyBpbmNsdWRlZCkgd2hlbiBkZWNsYXJlZCwgb3RoZXJ3aXNlXG4gICAqIHtAbGluayBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlfSwgd2hpY2ggcmVzb3VyY2Utcm91dGVzIG11dGF0aW9ucyB0aHJvdWdoXG4gICAqIHRoZSBwbHVtYmVkIGNvbmZpZ3VyYXRpb24gcmVnaXN0cnkuIEFwcHMgZGVjbGFyZSB0aGUgc3RhdGljIGluc3RlYWQgb2ZcbiAgICogb3ZlcnJpZGluZyB0aGlzIG1ldGhvZC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuZGVmYXVsdH0gUmVwbGF5IHNlcnZpY2UgY2xhc3MuXG4gICAqL1xuICByZXBsYXlTZXJ2aWNlQ2xhc3MoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFN5bmNSZXNvdXJjZUJhc2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHt0eXBlb2YgU3luY1Jlc291cmNlQmFzZSB8IG51bGx9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSA/PyBudWxsKVxuXG4gICAgcmV0dXJuIFJlc291cmNlQ2xhc3MuUmVwbGF5U2VydmljZUNsYXNzID8/IFNoYXJlZFJlc291cmNlPy5SZXBsYXlTZXJ2aWNlQ2xhc3MgPz8gU3luY0VudmVsb3BlUmVwbGF5U2VydmljZVxuICB9XG59XG4iXX0=