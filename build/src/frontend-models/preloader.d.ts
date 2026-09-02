/**
 * Preloads relationships onto already-loaded frontend model instances.
 *
 * Unlike the backend ORM preloader (which queries relationship tables
 * directly), the frontend re-fetches the parent records through their
 * `index` endpoint with the preload/select params, then copies the resulting
 * top-level preloaded relationships onto the existing instances. Relationships
 * that are already preloaded with the required columns present are skipped,
 * so repeated calls reuse the relationship cache instead of issuing duplicate
 * requests.
 */
export default class FrontendModelPreloader {
    /**
     * Runs preload.
     * @param {Array<import("./base.js").default>} models - Frontend model instances to preload onto.
     * @param {import("./query.js").default<import("./base.js").FrontendModelClass> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} queryOrSpec - A query built via `Model.preload(...).select(...)`, or a raw preload spec.
     * @param {{force?: boolean}} [options] - Options.
     * @returns {Promise<void>} - Resolves when preloading completes.
     */
    static preload(models: Array<import("./base.js").default>, queryOrSpec: import("./query.js").default<import("./base.js").FrontendModelClass> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>, { force }?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Runs model needs reload.
     * @param {object} args - Options object.
     * @param {import("./base.js").FrontendModelClass} args.modelClass - Model class the preload graph is rooted at.
     * @param {import("./base.js").default} args.model - Model instance.
     * @param {import("../database/query/index.js").NestedPreloadRecord} args.preload - Preload sub-graph to satisfy.
     * @param {import("./query.js").default<import("./base.js").FrontendModelClass>} args.query - Source query carrying select/selectsExtra.
     * @param {boolean} args.force - Whether to reload regardless of cached state.
     * @returns {boolean} - Whether the model needs a reload request.
     */
    static _modelNeedsReload({ modelClass, model, preload, query, force }: {
        modelClass: import("./base.js").FrontendModelClass;
        model: import("./base.js").default;
        preload: import("../database/query/index.js").NestedPreloadRecord;
        query: import("./query.js").default<import("./base.js").FrontendModelClass>;
        force: boolean;
    }): boolean;
    /**
     * A relationship is satisfied when it is already preloaded, every required
     * `select` attribute is present on each loaded target, and any nested preload
     * sub-graph is recursively satisfied on those targets. `selectsExtra` can
     * never be proven satisfied from the cache (the backend serializes the
     * client-unknown default attributes plus the extras), so it always reloads.
     * With no select and no nested preload, being preloaded is enough.
     * @param {object} args - Options object.
     * @param {import("./base.js").FrontendModelClass} args.modelClass - Model class owning the relationship.
     * @param {import("./base.js").default} args.model - Model instance.
     * @param {string} args.relationshipName - Relationship name.
     * @param {import("../database/query/index.js").NestedPreloadRecord[string]} args.subPreload - Preload value for this relationship (`true` or a nested record).
     * @param {import("./query.js").default<import("./base.js").FrontendModelClass>} args.query - Source query carrying select/selectsExtra.
     * @returns {boolean} - Whether the relationship is already satisfied.
     */
    static _relationshipSatisfied({ modelClass, model, relationshipName, subPreload, query }: {
        modelClass: import("./base.js").FrontendModelClass;
        model: import("./base.js").default;
        relationshipName: string;
        subPreload: import("../database/query/index.js").NestedPreloadRecord[string];
        query: import("./query.js").default<import("./base.js").FrontendModelClass>;
    }): boolean;
    /**
     * Runs nested preload record.
     * @param {import("../database/query/index.js").NestedPreloadRecord[string]} subPreload - Preload value for a relationship.
     * @returns {import("../database/query/index.js").NestedPreloadRecord | null} - Nested preload record, or null when there is no deeper graph.
     */
    static _nestedPreloadRecord(subPreload: import("../database/query/index.js").NestedPreloadRecord[string]): import("../database/query/index.js").NestedPreloadRecord | null;
}
//# sourceMappingURL=preloader.d.ts.map