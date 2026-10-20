// @ts-check
import { forcedNonBlankString } from "typanic";
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js";
import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js";
import SyncModelChangeFeedService from "./sync-model-change-feed-service.js";
import { syncUpstreamImporterForConfiguration } from "./sync-upstream-importer.js";
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
     * Keeps the sync resource's established public error contract for invalid
     * quick-search payloads; the quick-search mechanism itself lives on
     * FrontendModelBaseResource.
     * @returns {string} - Error label.
     */
    quickSearchErrorLabel() {
        return "Sync quick search";
    }
    /**
     * Keeps the established public error code for invalid quick-search payloads.
     * @returns {string} - Error code.
     */
    quickSearchErrorCode() {
        return "sync-invalid-quick-search";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1yZXNvdXJjZS1iYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1yZXNvdXJjZS1iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsb0JBQW9CLEVBQUMsTUFBTSxTQUFTLENBQUE7QUFFNUMsT0FBTyx5QkFBeUIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNuRixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sMEJBQTBCLE1BQU0scUNBQXFDLENBQUE7QUFDNUUsT0FBTyxFQUFDLG9DQUFvQyxFQUFDLE1BQU0sNkJBQTZCLENBQUE7QUFFaEY7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFpQixTQUFRLHlCQUF5QjtJQUNyRSwrRUFBK0U7SUFDL0UsTUFBTSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7SUFFN0I7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFFckM7Ozs7O09BS0c7SUFDSCxxQkFBcUI7UUFDbkIsT0FBTyxtQkFBbUIsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLE9BQU8sMkJBQTJCLENBQUE7SUFDcEMsQ0FBQztJQUVELG1FQUFtRTtJQUNuRSx5RUFBeUU7SUFDekUsNENBQTRDO0lBRTVDOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQzVCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFdkMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUU1QyxP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QUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FrQkc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQztRQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRTdDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUM5QyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUMsV0FBVyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsYUFBYSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBRTdGLE9BQU8sT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsa0JBQWtCO1FBQ2hCLE1BQU0sYUFBYSxHQUFHLHNDQUFzQyxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQy9FLE1BQU0sY0FBYyxHQUFHLDZDQUE2QyxDQUFDLENBQUMsYUFBYSxDQUFDLG1CQUFtQixFQUFFLElBQUksSUFBSSxDQUFDLENBQUE7UUFFbEgsT0FBTyxhQUFhLENBQUMsa0JBQWtCLElBQUksY0FBYyxFQUFFLGtCQUFrQixJQUFJLHlCQUF5QixDQUFBO0lBQzVHLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2ZvcmNlZE5vbkJsYW5rU3RyaW5nfSBmcm9tIFwidHlwYW5pY1wiXG5cbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIGZyb20gXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIlxuaW1wb3J0IFN5bmNNb2RlbENoYW5nZUZlZWRTZXJ2aWNlIGZyb20gXCIuL3N5bmMtbW9kZWwtY2hhbmdlLWZlZWQtc2VydmljZS5qc1wiXG5pbXBvcnQge3N5bmNVcHN0cmVhbUltcG9ydGVyRm9yQ29uZmlndXJhdGlvbn0gZnJvbSBcIi4vc3luYy11cHN0cmVhbS1pbXBvcnRlci5qc1wiXG5cbi8qKlxuICogT3B0aW9uYWwgY2xpZW50LWRlY2xhcmVkIHN5bmMgc2NvcGUgY2FycmllZCBvbiBhIGNoYW5nZXMgcmVxdWVzdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNlcmlhbGl6ZWRDaGFuZ2VzU2NvcGVcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gUGxhaW4gYXR0cmlidXRlIGNvbmRpdGlvbnMgZnJvbSB0aGUgY2xpZW50IHF1ZXJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSByZXNvdXJjZVR5cGUgLSBDbGllbnQgcmVzb3VyY2UvbW9kZWwgbmFtZSB0aGUgc2NvcGUgd2FzIGRlY2xhcmVkIGZvciwgb3IgbnVsbCBmb3IgdGhlIGFsbC10eXBlcyAodXNlcikgc2NvcGU6IG9uZSBzY29wZSBjb3ZlcmluZyBldmVyeSByZXNvdXJjZSB0eXBlIHRoaXMgcmVzb3VyY2UgYXV0aG9yaXplcyBmb3IgdGhlIGNhbGxlciwgc28gYSBzeW5jIGF1dGhvcml6ZXMgb25jZSBob3dldmVyIG1hbnkgdHlwZXMgaXQgc2VydmVzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXSB8IG51bGx9IHJlc291cmNlVHlwZXMgLSBGb3IgdGhlIGFsbC10eXBlcyBzY29wZSwgdGhlIHJlc291cmNlIHR5cGVzIHRoZSBjbGllbnQgY2FuIGFwcGx5LiBBIGNoZWFwIGRlbGl2ZXJ5L3R5cGUgZmlsdGVyIG9ubHkgLSBpdCBuYXJyb3dzLCBuZXZlciB3aWRlbnMsIHdoYXQgdGhlIGFwcCdzIGF1dGhvcml6YXRpb24gYWxyZWFkeSBhbGxvd3MuIE51bGwgZm9yIGEgdHlwZS1kZWNsYXJlZCBzY29wZS5cbiAqL1xuXG4vKipcbiAqIE9uZSBwdWJsaXNoZWQgc3luYyBlbnRyeSBhcyBkZWxpdmVyZWQgdG8gdGhlIHBlci1kZWxpdmVyeSBhY2Nlc3MgcmUtY2hlY2tcbiAqICh7QGxpbmsgU3luY1Jlc291cmNlQmFzZSNjaGFuZ2VEZWxpdmVyYWJsZX0pOiB0aGUgY29tcGxldGUgYnJvYWRjYXN0IHN5bmNcbiAqIGVudHJ5IOKAlCBpbmNsdWRpbmcgdGhlIGltbXV0YWJsZSBzeW5jLXJvdyBpZCwgYWN0b3Itc3BlY2lmaWMgbWV0YWRhdGEsIGFuZFxuICogYW55IG90aGVyIGFwcCBmaWVsZHMgdGhlIHB1Ymxpc2hlciBwdXQgb24gaXQg4oCUIHdpdGggYHJlc291cmNlSWRgIGFuZFxuICogYHJlc291cmNlVHlwZWAgbm9ybWFsaXplZCB0byBzdHJpbmdzLiBBcHBzIGF1dGhvcml6aW5nIGJ5IGV4YWN0LXJvd1xuICogaWRlbnRpdHkgcmVhZCB0aGUgZXh0cmEgZmllbGRzOyBvdmVycmlkZXMgdGhhdCBvbmx5IHJlYWRcbiAqIGByZXNvdXJjZUlkYC9gcmVzb3VyY2VUeXBlYCBrZWVwIHdvcmtpbmcgdW5jaGFuZ2VkLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiAmIHtyZXNvdXJjZUlkOiBzdHJpbmcsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gQ2hhbmdlRGVsaXZlcmFibGVTeW5jRW50cnlcbiAqL1xuLyoqXG4gKiBCYXNlIHJlc291cmNlIGZvciBWZWxvY2lvdXMgc3luYyBlbmRwb2ludHMuXG4gKlxuICogVmVsb2Npb3VzIG93bnMgdGhlIGNoYW5nZXMvcmVwbGF5IG9yY2hlc3RyYXRpb24gKHNjb3BlIHBhcnNpbmcsIGZlZWQgcGFnaW5nLFxuICogcmVwbGF5IGRlbGVnYXRpb24sIHJlc3BvbnNlIHNoYXBlKSB3aGlsZSBhcHBzIHN1YmNsYXNzIGFuZCBvbmx5IGRlY2xhcmVcbiAqIGF1dGhvcml6YXRpb24sIGZlZWQgc2NvcGluZywgYW5kIHRoZWlyIHJlcGxheSBzZXJ2aWNlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtUTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAYXVnbWVudHMge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3M+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jUmVzb3VyY2VCYXNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSZXBsYXkgc2VydmljZSBjbGFzcyBoYW5kbGluZyByZXBsYXkgbXV0YXRpb25zIGZvciB0aGlzIHJlc291cmNlLFxuICAgKiBkZWNsYXJlZCBpbnN0ZWFkIG9mIG92ZXJyaWRpbmcge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UjcmVwbGF5U2VydmljZUNsYXNzfS5cbiAgICogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH1cbiAgICovXG4gIHN0YXRpYyBSZXBsYXlTZXJ2aWNlQ2xhc3MgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogS2VlcHMgdGhlIHN5bmMgcmVzb3VyY2UncyBlc3RhYmxpc2hlZCBwdWJsaWMgZXJyb3IgY29udHJhY3QgZm9yIGludmFsaWRcbiAgICogcXVpY2stc2VhcmNoIHBheWxvYWRzOyB0aGUgcXVpY2stc2VhcmNoIG1lY2hhbmlzbSBpdHNlbGYgbGl2ZXMgb25cbiAgICogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBFcnJvciBsYWJlbC5cbiAgICovXG4gIHF1aWNrU2VhcmNoRXJyb3JMYWJlbCgpIHtcbiAgICByZXR1cm4gXCJTeW5jIHF1aWNrIHNlYXJjaFwiXG4gIH1cblxuICAvKipcbiAgICogS2VlcHMgdGhlIGVzdGFibGlzaGVkIHB1YmxpYyBlcnJvciBjb2RlIGZvciBpbnZhbGlkIHF1aWNrLXNlYXJjaCBwYXlsb2Fkcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBFcnJvciBjb2RlLlxuICAgKi9cbiAgcXVpY2tTZWFyY2hFcnJvckNvZGUoKSB7XG4gICAgcmV0dXJuIFwic3luYy1pbnZhbGlkLXF1aWNrLXNlYXJjaFwiXG4gIH1cblxuICAvLyBUaGUgZGVjbGFyYXRpdmUgYHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXNgIHBlcm1pdCBsaXN0IGxpdmVzIG9uXG4gIC8vIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc28gZXZlcnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgY2FuIGRlY2xhcmVcbiAgLy8gb25lOyBzeW5jIHJlc291cmNlcyBpbmhlcml0IGl0IHVuY2hhbmdlZC5cblxuICAvKipcbiAgICogUmV0dXJucyBhIHN0YWJsZSBjaGFuZ2UtZmVlZCBwYWdlIGFmdGVyIGFwcCBhdXRob3JpemF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBDaGFuZ2UtZmVlZCBwYWdlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNoYW5nZXMoKSB7XG4gICAgY29uc3QgcGFyYW1zID0gdGhpcy5wYXJhbXMoKVxuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5jaGFuZ2VzU2NvcGUocGFyYW1zKVxuXG4gICAgYXdhaXQgdGhpcy5hdXRob3JpemVDaGFuZ2VzKHtwYXJhbXMsIHNjb3BlfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNoYW5nZUZlZWRTZXJ2aWNlKHtwYXJhbXMsIHNjb3BlfSkuY2hhbmdlcygpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyBjbGllbnQgc3luYyBlbnZlbG9wZXMgdGhyb3VnaCB0aGUgYXBwIHJlcGxheSBzZXJ2aWNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBSZXBsYXkgcmVzdWx0IHdpdGggcGVyLXN5bmMgc3RhdGVzLlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5KCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYnVpbGRSZXBsYXlTZXJ2aWNlKCkucmVwbGF5KHRoaXMucGFyYW1zKCkpXG5cbiAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gXCJlcnJvclwiKSByZXR1cm4gcmVzdWx0XG5cbiAgICByZXR1cm4ge3N0YXR1czogXCJzdWNjZXNzXCIsIHN5bmNzOiByZXN1bHQuc3luY3N9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHRoZSBvcHRpb25hbCBjbGllbnQtZGVjbGFyZWQgc2NvcGUgZnJvbSByZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7U2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGx9IFBhcnNlZCBzY29wZSwgb3IgbnVsbCB3aGVuIHRoZSBjbGllbnQgc2VudCBub25lLlxuICAgKi9cbiAgY2hhbmdlc1Njb3BlKHBhcmFtcykge1xuICAgIGNvbnN0IHNjb3BlID0gcGFyYW1zLnNjb3BlXG5cbiAgICBpZiAoc2NvcGUgPT09IHVuZGVmaW5lZCB8fCBzY29wZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGlmICh0eXBlb2Ygc2NvcGUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzY29wZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBjaGFuZ2VzIHNjb3BlIG11c3QgYmUgYW4gb2JqZWN0LCBnb3Q6ICR7U3RyaW5nKHNjb3BlKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlUGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzY29wZSlcbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBzY29wZVBhcmFtcy5yZXNvdXJjZVR5cGUgPT09IG51bGwgfHwgc2NvcGVQYXJhbXMucmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWRcbiAgICAgID8gbnVsbFxuICAgICAgOiBmb3JjZWROb25CbGFua1N0cmluZyhzY29wZVBhcmFtcy5yZXNvdXJjZVR5cGUsIFwicmVzb3VyY2VUeXBlXCIpXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlcyA9IHRoaXMuY2hhbmdlc1Njb3BlUmVzb3VyY2VUeXBlcyhzY29wZVBhcmFtcy5yZXNvdXJjZVR5cGVzKVxuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBzY29wZVBhcmFtcy5jb25kaXRpb25zXG5cbiAgICBpZiAoIWNvbmRpdGlvbnMgfHwgdHlwZW9mIGNvbmRpdGlvbnMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb25kaXRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNoYW5nZXMgc2NvcGUuY29uZGl0aW9ucyBtdXN0IGJlIGFuIG9iamVjdCwgZ290OiAke1N0cmluZyhjb25kaXRpb25zKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7Y29uZGl0aW9uczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25kaXRpb25zKSwgcmVzb3VyY2VUeXBlLCByZXNvdXJjZVR5cGVzfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyB0aGUgb3B0aW9uYWwgcmVzb3VyY2UtdHlwZSBsaXN0IGFuIGFsbC10eXBlcyBzY29wZSBkZWNsYXJlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBSYXcgYHNjb3BlLnJlc291cmNlVHlwZXNgIHBhcmFtLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSBEZWNsYXJlZCByZXNvdXJjZSB0eXBlcywgb3IgbnVsbCB3aGVuIHRoZSBjbGllbnQgc2VudCBub25lLlxuICAgKi9cbiAgY2hhbmdlc1Njb3BlUmVzb3VyY2VUeXBlcyh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNoYW5nZXMgc2NvcGUucmVzb3VyY2VUeXBlcyBtdXN0IGJlIGFuIGFycmF5LCBnb3Q6ICR7U3RyaW5nKHZhbHVlKX1gKVxuXG4gICAgcmV0dXJuIHZhbHVlLm1hcCgocmVzb3VyY2VUeXBlKSA9PiBmb3JjZWROb25CbGFua1N0cmluZyhyZXNvdXJjZVR5cGUsIFwicmVzb3VyY2VUeXBlc1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNoYW5nZS1mZWVkIHNlcnZpY2Ugc2VydmluZyB0aGlzIGNoYW5nZXMgcmVxdWVzdC5cbiAgICogQHBhcmFtIHt7cGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNjb3BlOiBTZXJpYWxpemVkQ2hhbmdlc1Njb3BlIHwgbnVsbH19IGFyZ3MgLSBSZXF1ZXN0IHBhcmFtcyBhbmQgcGFyc2VkIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7e2NoYW5nZXM6ICgpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19IENoYW5nZS1mZWVkIHNlcnZpY2UuXG4gICAqL1xuICBjaGFuZ2VGZWVkU2VydmljZSh7cGFyYW1zLCBzY29wZX0pIHtcbiAgICByZXR1cm4gbmV3IFN5bmNNb2RlbENoYW5nZUZlZWRTZXJ2aWNlKHtcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuc3luY01vZGVsQ2xhc3MoKSxcbiAgICAgIHBhcmFtcyxcbiAgICAgIHNjb3BlUXVlcnk6ICh7cXVlcnl9KSA9PiB0aGlzLnNjb3BlQ2hhbmdlc1F1ZXJ5KHtwYXJhbXMsIHF1ZXJ5LCBzY29wZX0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFwcCByZXBsYXkgc2VydmljZSBoYW5kbGluZyB0aGlzIHJlcGxheSByZXF1ZXN0LiBUaGUgcmVzb3VyY2VcbiAgICogYWJpbGl0eSwgY29udGV4dCwgY29uZmlndXJhdGlvbiwgYW5kIGxvY2FscyBhcmUgcGx1bWJlZCBpbiB1bmRlciB0aGVcbiAgICogYXBwLWRlY2xhcmVkIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlI3JlcGxheVNlcnZpY2VBcmdzfSAoYXBwIGFyZ3Mgd2luKSBzb1xuICAgKiB0aGUgZGVmYXVsdCByZXNvdXJjZS1yb3V0ZWQgcmVwbGF5IHdvcmtzIHdpdGhvdXQgd2lyaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLmRlZmF1bHR9IFJlcGxheSBzZXJ2aWNlIGluc3RhbmNlLlxuICAgKi9cbiAgYnVpbGRSZXBsYXlTZXJ2aWNlKCkge1xuICAgIGNvbnN0IFJlcGxheVNlcnZpY2VDbGFzcyA9IHRoaXMucmVwbGF5U2VydmljZUNsYXNzKClcblxuICAgIHJldHVybiBuZXcgUmVwbGF5U2VydmljZUNsYXNzKHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSxcbiAgICAgIGFiaWxpdHlDb250ZXh0OiB0aGlzLmdldENvbnRleHQoKSxcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29udHJvbGxlciA/IHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkuZ2V0Q29uZmlndXJhdGlvbigpIDogdW5kZWZpbmVkLFxuICAgICAgbG9jYWxzOiB0aGlzLmdldExvY2FscygpLFxuICAgICAgLi4udGhpcy5yZXBsYXlTZXJ2aWNlQXJncygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGNvbnN0cnVjdG9yIGFyZ3MgZm9yIHRoZSBhcHAgcmVwbGF5IHNlcnZpY2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFJlcGxheSBzZXJ2aWNlIGNvbnN0cnVjdG9yIGFyZ3MuXG4gICAqL1xuICByZXBsYXlTZXJ2aWNlQXJncygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzeW5jIG1vZGVsIGNsYXNzIGJhY2tpbmcgdGhlIGNoYW5nZSBmZWVkLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3luY01vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFN5bmNSZXNvdXJjZUJhc2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKS5Nb2RlbENsYXNzXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IG11c3QgZGVmaW5lIHN0YXRpYyBNb2RlbENsYXNzYClcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2hhcmVkIHVwc3RyZWFtIGltcG9ydGVyIGZvciB0aGlzIHJlc291cmNlJ3MgY29uZmlndXJhdGlvbi4gQXBwc1xuICAgKiB1c2UgaXQgaW5zaWRlIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlI2F1dGhvcml6ZUNoYW5nZXN9IChvciBhIGxlZ2FjeSB0cmlnZ2VyXG4gICAqIGVuZHBvaW50KSB0byBydW4gdGhlIHVwc3RyZWFtIGltcG9ydCB0aGF0IGtlZXBzIHRoZSBmZWVkIHNlbGYtc3VzdGFpbmluZyxcbiAgICogd2l0aCBjb2FsZXNjaW5nIGFuZCB0aHJvdHRsaW5nIG93bmVkIGJ5IHRoZSBmcmFtZXdvcmsuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N5bmMtdXBzdHJlYW0taW1wb3J0ZXIuanNcIikuZGVmYXVsdH0gU2hhcmVkIGltcG9ydGVyIGZvciB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3luY1Vwc3RyZWFtSW1wb3J0ZXIoKSB7XG4gICAgcmV0dXJuIHN5bmNVcHN0cmVhbUltcG9ydGVyRm9yQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24oKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRob3JpemVzIHRoZSBjdXJyZW50IGNvbnRleHQgZm9yIHJlYWRpbmcgdGhlIHJlcXVlc3RlZCBjaGFuZ2VzLlxuICAgKiBAcGFyYW0ge3twYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2NvcGU6IFNlcmlhbGl6ZWRDaGFuZ2VzU2NvcGUgfCBudWxsfX0gX2FyZ3MgLSBSZXF1ZXN0IHBhcmFtcyBhbmQgcGFyc2VkIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBhY2Nlc3MgaXMgYWxsb3dlZDsgdGhyb3dzIG90aGVyd2lzZS5cbiAgICovXG4gIGFzeW5jIGF1dGhvcml6ZUNoYW5nZXMoX2FyZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jUmVzb3VyY2VCYXNlI2F1dGhvcml6ZUNoYW5nZXMgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYXBwIHZpc2liaWxpdHkgc2NvcGluZyBvbnRvIHRoZSBjaGFuZ2UtZmVlZCBxdWVyeS5cbiAgICogQHBhcmFtIHt7cGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0LCBzY29wZTogU2VyaWFsaXplZENoYW5nZXNTY29wZSB8IG51bGx9fSBfYXJncyAtIFJlcXVlc3QgcGFyYW1zLCBmZWVkIHF1ZXJ5LCBhbmQgcGFyc2VkIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjb3BlQ2hhbmdlc1F1ZXJ5KF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY1Jlc291cmNlQmFzZSNzY29wZUNoYW5nZXNRdWVyeSBtdXN0IGJlIGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogRGVjaWRlcyB3aGV0aGVyIG9uZSBwdWJsaXNoZWQgY2hhbmdlIGlzIGRlbGl2ZXJhYmxlIHRvIGEgdXNlci1zY29wZVxuICAgKiBzdWJzY3JpcHRpb24gKHRoZSBmcmFtZXdvcmsgc3luYyBjaGFubmVsJ3MgcGVyLWRlbGl2ZXJ5IGFjY2VzcyByZS1jaGVjaykuXG4gICAqIFRoZSBkZWZhdWx0IHJldXNlcyB0aGUgYXBwJ3MgYWJpbGl0eSBzY29waW5nOiBpdCBhcHBsaWVzXG4gICAqIHtAbGluayBTeW5jUmVzb3VyY2VCYXNlI3Njb3BlQ2hhbmdlc1F1ZXJ5fSB0byB0aGUgY2hhbmdlLWZlZWQgbW9kZWwg4oCUIHdoaWNoXG4gICAqIGZvciBhbiBlbXB0eS1jb25kaXRpb25zIHVzZXIgc2NvcGUgZmFsbHMgYmFjayB0byBhYmlsaXR5IHNjb3Bpbmcg4oCUIGFuZFxuICAgKiBjaGVja3Mgd2hldGhlciB0aGUgcHVibGlzaGVkIGNoYW5nZSdzIGZlZWQgcm93IGlzIHZpc2libGUgd2l0aGluIHRoYXRcbiAgICogc2NvcGUuIEFwcHMgZ2V0IHRoaXMgZm9yIGZyZWUgZnJvbSB0aGUgc2NvcGluZyB0aGV5IGFscmVhZHkgZGVjbGFyZWQ7XG4gICAqIG92ZXJyaWRlIG9ubHkgZm9yIGN1c3RvbSBwZXItZGVsaXZlcnkgcnVsZXMuXG4gICAqXG4gICAqIFRoZSBgc3luY2AgYXJndW1lbnQgaXMgdGhlIGNvbXBsZXRlIGJyb2FkY2FzdCBzeW5jIGVudHJ5IOKAlCBpbW11dGFibGVcbiAgICogc3luYy1yb3cgaWQsIGFjdG9yLXNwZWNpZmljIG1ldGFkYXRhLCBhbmQgYW55IG90aGVyIHB1Ymxpc2hlciBmaWVsZHMg4oCUXG4gICAqIHdpdGggYHJlc291cmNlSWRgL2ByZXNvdXJjZVR5cGVgIG5vcm1hbGl6ZWQgdG8gc3RyaW5ncywgc28gYW4gb3ZlcnJpZGVcbiAgICogY2FuIGF1dGhvcml6ZSBjb25jdXJyZW50IHRhcmdldGVkIGFuZCBzaGFyZWQgYnJvYWRjYXN0cyBmb3IgdGhlIHNhbWVcbiAgICogcmVzb3VyY2UgaWRlbnRpdHkgaW5kZXBlbmRlbnRseSBieSB0aGVpciBleGFjdC1yb3cgaWRlbnRpdHkuIFRoZSBjaGFubmVsXG4gICAqIG5ldmVyIG11dGF0ZXMgdGhlIHB1Ymxpc2hlZCBlbnRyeTsgbm9ybWFsaXphdGlvbiBoYXBwZW5zIG9uIGEgY29weS5cbiAgICogQHBhcmFtIHt7cGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNjb3BlOiBTZXJpYWxpemVkQ2hhbmdlc1Njb3BlIHwgbnVsbCwgc3luYzogQ2hhbmdlRGVsaXZlcmFibGVTeW5jRW50cnl9fSBhcmdzIC0gUmVxdWVzdCBwYXJhbXMsIHN1YnNjcmlwdGlvbiBzY29wZSwgYW5kIHRoZSBwdWJsaXNoZWQgc3luYyBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGNoYW5nZSBtYXkgYmUgZGVsaXZlcmVkIHRvIHRoaXMgc3Vic2NyaXB0aW9uLlxuICAgKi9cbiAgYXN5bmMgY2hhbmdlRGVsaXZlcmFibGUoe3BhcmFtcywgc2NvcGUsIHN5bmN9KSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLnN5bmNNb2RlbENsYXNzKCkud2hlcmUoe30pXG5cbiAgICB0aGlzLnNjb3BlQ2hhbmdlc1F1ZXJ5KHtwYXJhbXMsIHF1ZXJ5LCBzY29wZX0pXG4gICAgcXVlcnkud2hlcmUoe3Jlc291cmNlX2lkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKSwgcmVzb3VyY2VfdHlwZTogU3RyaW5nKHN5bmMucmVzb3VyY2VUeXBlKX0pXG5cbiAgICByZXR1cm4gQm9vbGVhbihhd2FpdCBxdWVyeS5maXJzdCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSByZXBsYXkgc2VydmljZSBjbGFzcyBoYW5kbGluZyByZXBsYXkgbXV0YXRpb25zOiB0aGVcbiAgICogZGVjbGFyYXRpdmUge0BsaW5rIFN5bmNSZXNvdXJjZUJhc2UuUmVwbGF5U2VydmljZUNsYXNzfSBzdGF0aWMgKHNoYXJlZFxuICAgKiByZXNvdXJjZXMgaW5jbHVkZWQpIHdoZW4gZGVjbGFyZWQsIG90aGVyd2lzZVxuICAgKiB7QGxpbmsgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZX0sIHdoaWNoIHJlc291cmNlLXJvdXRlcyBtdXRhdGlvbnMgdGhyb3VnaFxuICAgKiB0aGUgcGx1bWJlZCBjb25maWd1cmF0aW9uIHJlZ2lzdHJ5LiBBcHBzIGRlY2xhcmUgdGhlIHN0YXRpYyBpbnN0ZWFkIG9mXG4gICAqIG92ZXJyaWRpbmcgdGhpcyBtZXRob2QuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLmRlZmF1bHR9IFJlcGxheSBzZXJ2aWNlIGNsYXNzLlxuICAgKi9cbiAgcmVwbGF5U2VydmljZUNsYXNzKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBTeW5jUmVzb3VyY2VCYXNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7dHlwZW9mIFN5bmNSZXNvdXJjZUJhc2UgfCBudWxsfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkgPz8gbnVsbClcblxuICAgIHJldHVybiBSZXNvdXJjZUNsYXNzLlJlcGxheVNlcnZpY2VDbGFzcyA/PyBTaGFyZWRSZXNvdXJjZT8uUmVwbGF5U2VydmljZUNsYXNzID8/IFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2VcbiAgfVxufVxuIl19