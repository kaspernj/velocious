// @ts-check
import { modelPrimaryKeyCacheKey, scalarModelPrimaryKey } from "../utils/model-primary-key.js";
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
    static async preload(models, queryOrSpec, { force = false } = {}) {
        if (!models || models.length === 0)
            return;
        const modelClass = /** @type {import("./base.js").FrontendModelClass} */ (models[0].constructor);
        const isQuery = Boolean(queryOrSpec) && typeof queryOrSpec === "object" && "_preload" in queryOrSpec;
        const query = isQuery
            ? /** @type {import("./query.js").default<import("./base.js").FrontendModelClass>} */ (queryOrSpec)
            : modelClass.preload(/** @type {ReturnType<typeof JSON.parse>} */ (queryOrSpec));
        const topLevelRelationships = Object.keys(query._preload);
        if (topLevelRelationships.length === 0)
            return;
        const modelsToLoad = models.filter((model) => this._modelNeedsReload({ modelClass, model, preload: query._preload, query, force }));
        if (modelsToLoad.length === 0)
            return;
        const primaryKeyDefinition = modelClass.primaryKey();
        const primaryKey = scalarModelPrimaryKey(primaryKeyDefinition, `FrontendModelPreloader.preload() for ${modelClass.name}`);
        const ids = modelsToLoad.map((model) => model.primaryKeyValue());
        // Rebuild a fresh query carrying only the projection-relevant state so a
        // user-supplied limit/sort/where on the source query doesn't leak in.
        const reloadQuery = modelClass.preload(query._preload);
        reloadQuery._select = query._select;
        reloadQuery._selectsExtra = query._selectsExtra;
        reloadQuery._withCount = query._withCount;
        reloadQuery._abilities = query._abilities;
        reloadQuery._queryData = query._queryData;
        reloadQuery.where({ [primaryKey]: ids });
        const reloaded = await reloadQuery.toArray();
        /**
         * Reloaded by id.
         * @type {Map<string, import("./base.js").default>} */
        const reloadedById = new Map();
        for (const reloadedModel of reloaded) {
            reloadedById.set(modelPrimaryKeyCacheKey(primaryKeyDefinition, reloadedModel.primaryKeyValue()), reloadedModel);
        }
        for (const model of modelsToLoad) {
            const reloadedModel = reloadedById.get(modelPrimaryKeyCacheKey(primaryKeyDefinition, model.primaryKeyValue()));
            // The record may have been deleted/filtered between the original load and
            // this preload — skip it rather than crashing on a missing reload.
            if (!reloadedModel)
                continue;
            for (const relationshipName of topLevelRelationships) {
                const sourceRelationship = reloadedModel.getRelationshipByName(relationshipName);
                const targetRelationship = model.getRelationshipByName(relationshipName);
                targetRelationship.copyLoadedFrom(sourceRelationship);
            }
        }
    }
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
    static _modelNeedsReload({ modelClass, model, preload, query, force }) {
        if (force)
            return true;
        for (const relationshipName of Object.keys(preload)) {
            if (!this._relationshipSatisfied({ modelClass, model, relationshipName, subPreload: preload[relationshipName], query }))
                return true;
        }
        return false;
    }
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
    static _relationshipSatisfied({ modelClass, model, relationshipName, subPreload, query }) {
        const relationship = model.getRelationshipByName(relationshipName);
        if (!relationship.getPreloaded())
            return false;
        const targetModelClass = modelClass.relationshipModelClass(relationshipName);
        const loaded = relationship.loaded();
        const targets = loaded == null ? [] : (Array.isArray(loaded) ? loaded : [loaded]);
        if (targetModelClass) {
            const targetModelName = targetModelClass.getModelName();
            // `selectsExtra` serializes the default attributes (unknown to the client)
            // plus the extras, so a cached target can't be proven complete.
            if (query._selectsExtra[targetModelName])
                return false;
            const required = query._select[targetModelName] || [];
            for (const target of targets) {
                for (const attributeName of required) {
                    if (!target.hasLoadedAttribute(attributeName))
                        return false;
                }
            }
        }
        const nestedPreload = this._nestedPreloadRecord(subPreload);
        if (nestedPreload && targetModelClass) {
            for (const target of targets) {
                if (this._modelNeedsReload({ modelClass: targetModelClass, model: target, preload: nestedPreload, query, force: false })) {
                    return false;
                }
            }
        }
        return true;
    }
    /**
     * Runs nested preload record.
     * @param {import("../database/query/index.js").NestedPreloadRecord[string]} subPreload - Preload value for a relationship.
     * @returns {import("../database/query/index.js").NestedPreloadRecord | null} - Nested preload record, or null when there is no deeper graph.
     */
    static _nestedPreloadRecord(subPreload) {
        if (!subPreload || typeof subPreload !== "object")
            return null;
        if (Object.keys(subPreload).length === 0)
            return null;
        return /** @type {import("../database/query/index.js").NestedPreloadRecord} */ (subPreload);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy9wcmVsb2FkZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSxxQkFBcUIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBRTVGOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsV0FBVyxFQUFFLEVBQUMsS0FBSyxHQUFHLEtBQUssRUFBQyxHQUFHLEVBQUU7UUFDNUQsSUFBSSxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTFDLE1BQU0sVUFBVSxHQUFHLHFEQUFxRCxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ2hHLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSxPQUFPLFdBQVcsS0FBSyxRQUFRLElBQUksVUFBVSxJQUFJLFdBQVcsQ0FBQTtRQUNwRyxNQUFNLEtBQUssR0FBRyxPQUFPO1lBQ25CLENBQUMsQ0FBQyxtRkFBbUYsQ0FBQyxDQUFDLFdBQVcsQ0FBQztZQUNuRyxDQUFDLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUE7UUFFbEYsTUFBTSxxQkFBcUIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV6RCxJQUFJLHFCQUFxQixDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUU5QyxNQUFNLFlBQVksR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVB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QUFDLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxhQUFhLENBQUM7d0JBQUUsT0FBTyxLQUFLLENBQUE7Z0JBQzdELENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUUzRCxJQUFJLGFBQWEsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RDLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdCLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQyxDQUFDLEVBQUUsQ0FBQztvQkFDdkgsT0FBTyxLQUFLLENBQUE7Z0JBQ2QsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVO1FBQ3BDLElBQUksQ0FBQyxVQUFVLElBQUksT0FBTyxVQUFVLEtBQUssUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQzlELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXJELE9BQU8sdUVBQXVFLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUM3RixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5fSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIFByZWxvYWRzIHJlbGF0aW9uc2hpcHMgb250byBhbHJlYWR5LWxvYWRlZCBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKlxuICogVW5saWtlIHRoZSBiYWNrZW5kIE9STSBwcmVsb2FkZXIgKHdoaWNoIHF1ZXJpZXMgcmVsYXRpb25zaGlwIHRhYmxlc1xuICogZGlyZWN0bHkpLCB0aGUgZnJvbnRlbmQgcmUtZmV0Y2hlcyB0aGUgcGFyZW50IHJlY29yZHMgdGhyb3VnaCB0aGVpclxuICogYGluZGV4YCBlbmRwb2ludCB3aXRoIHRoZSBwcmVsb2FkL3NlbGVjdCBwYXJhbXMsIHRoZW4gY29waWVzIHRoZSByZXN1bHRpbmdcbiAqIHRvcC1sZXZlbCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcyBvbnRvIHRoZSBleGlzdGluZyBpbnN0YW5jZXMuIFJlbGF0aW9uc2hpcHNcbiAqIHRoYXQgYXJlIGFscmVhZHkgcHJlbG9hZGVkIHdpdGggdGhlIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBhcmUgc2tpcHBlZCxcbiAqIHNvIHJlcGVhdGVkIGNhbGxzIHJldXNlIHRoZSByZWxhdGlvbnNoaXAgY2FjaGUgaW5zdGVhZCBvZiBpc3N1aW5nIGR1cGxpY2F0ZVxuICogcmVxdWVzdHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxQcmVsb2FkZXIge1xuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0Pn0gbW9kZWxzIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzIHRvIHByZWxvYWQgb250by5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz4gfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gQSBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAsIG9yIGEgcmF3IHByZWxvYWQgc3BlYy5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwcmVsb2FkKG1vZGVscywgcXVlcnlPclNwZWMsIHtmb3JjZSA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCFtb2RlbHMgfHwgbW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSAqLyAobW9kZWxzWzBdLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGlzUXVlcnkgPSBCb29sZWFuKHF1ZXJ5T3JTcGVjKSAmJiB0eXBlb2YgcXVlcnlPclNwZWMgPT09IFwib2JqZWN0XCIgJiYgXCJfcHJlbG9hZFwiIGluIHF1ZXJ5T3JTcGVjXG4gICAgY29uc3QgcXVlcnkgPSBpc1F1ZXJ5XG4gICAgICA/IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAqLyAocXVlcnlPclNwZWMpXG4gICAgICA6IG1vZGVsQ2xhc3MucHJlbG9hZCgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocXVlcnlPclNwZWMpKVxuXG4gICAgY29uc3QgdG9wTGV2ZWxSZWxhdGlvbnNoaXBzID0gT2JqZWN0LmtleXMocXVlcnkuX3ByZWxvYWQpXG5cbiAgICBpZiAodG9wTGV2ZWxSZWxhdGlvbnNoaXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbHNUb0xvYWQgPSBtb2RlbHMuZmlsdGVyKChtb2RlbCkgPT4gdGhpcy5fbW9kZWxOZWVkc1JlbG9hZCh7bW9kZWxDbGFzcywgbW9kZWwsIHByZWxvYWQ6IHF1ZXJ5Ll9wcmVsb2FkLCBxdWVyeSwgZm9yY2V9KSlcblxuICAgIGlmIChtb2RlbHNUb0xvYWQubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHByaW1hcnlLZXlEZWZpbml0aW9uID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KHByaW1hcnlLZXlEZWZpbml0aW9uLCBgRnJvbnRlbmRNb2RlbFByZWxvYWRlci5wcmVsb2FkKCkgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgY29uc3QgaWRzID0gbW9kZWxzVG9Mb2FkLm1hcCgobW9kZWwpID0+IG1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKVxuXG4gICAgLy8gUmVidWlsZCBhIGZyZXNoIHF1ZXJ5IGNhcnJ5aW5nIG9ubHkgdGhlIHByb2plY3Rpb24tcmVsZXZhbnQgc3RhdGUgc28gYVxuICAgIC8vIHVzZXItc3VwcGxpZWQgbGltaXQvc29ydC93aGVyZSBvbiB0aGUgc291cmNlIHF1ZXJ5IGRvZXNuJ3QgbGVhayBpbi5cbiAgICBjb25zdCByZWxvYWRRdWVyeSA9IG1vZGVsQ2xhc3MucHJlbG9hZChxdWVyeS5fcHJlbG9hZClcblxuICAgIHJlbG9hZFF1ZXJ5Ll9zZWxlY3QgPSBxdWVyeS5fc2VsZWN0XG4gICAgcmVsb2FkUXVlcnkuX3NlbGVjdHNFeHRyYSA9IHF1ZXJ5Ll9zZWxlY3RzRXh0cmFcbiAgICByZWxvYWRRdWVyeS5fd2l0aENvdW50ID0gcXVlcnkuX3dpdGhDb3VudFxuICAgIHJlbG9hZFF1ZXJ5Ll9hYmlsaXRpZXMgPSBxdWVyeS5fYWJpbGl0aWVzXG4gICAgcmVsb2FkUXVlcnkuX3F1ZXJ5RGF0YSA9IHF1ZXJ5Ll9xdWVyeURhdGFcbiAgICByZWxvYWRRdWVyeS53aGVyZSh7W3ByaW1hcnlLZXldOiBpZHN9KVxuXG4gICAgY29uc3QgcmVsb2FkZWQgPSBhd2FpdCByZWxvYWRRdWVyeS50b0FycmF5KClcblxuICAgIC8qKlxuICAgICAqIFJlbG9hZGVkIGJ5IGlkLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgcmVsb2FkZWRCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlbG9hZGVkTW9kZWwgb2YgcmVsb2FkZWQpIHtcbiAgICAgIHJlbG9hZGVkQnlJZC5zZXQobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleURlZmluaXRpb24sIHJlbG9hZGVkTW9kZWwucHJpbWFyeUtleVZhbHVlKCkpLCByZWxvYWRlZE1vZGVsKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzVG9Mb2FkKSB7XG4gICAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gcmVsb2FkZWRCeUlkLmdldChtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5RGVmaW5pdGlvbiwgbW9kZWwucHJpbWFyeUtleVZhbHVlKCkpKVxuXG4gICAgICAvLyBUaGUgcmVjb3JkIG1heSBoYXZlIGJlZW4gZGVsZXRlZC9maWx0ZXJlZCBiZXR3ZWVuIHRoZSBvcmlnaW5hbCBsb2FkIGFuZFxuICAgICAgLy8gdGhpcyBwcmVsb2FkIOKAlCBza2lwIGl0IHJhdGhlciB0aGFuIGNyYXNoaW5nIG9uIGEgbWlzc2luZyByZWxvYWQuXG4gICAgICBpZiAoIXJlbG9hZGVkTW9kZWwpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiB0b3BMZXZlbFJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3Qgc291cmNlUmVsYXRpb25zaGlwID0gcmVsb2FkZWRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgY29uc3QgdGFyZ2V0UmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgICAgdGFyZ2V0UmVsYXRpb25zaGlwLmNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBuZWVkcyByZWxvYWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdGhlIHByZWxvYWQgZ3JhcGggaXMgcm9vdGVkIGF0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gYXJncy5wcmVsb2FkIC0gUHJlbG9hZCBzdWItZ3JhcGggdG8gc2F0aXNmeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IGFyZ3MucXVlcnkgLSBTb3VyY2UgcXVlcnkgY2Fycnlpbmcgc2VsZWN0L3NlbGVjdHNFeHRyYS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmZvcmNlIC0gV2hldGhlciB0byByZWxvYWQgcmVnYXJkbGVzcyBvZiBjYWNoZWQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIG1vZGVsIG5lZWRzIGEgcmVsb2FkIHJlcXVlc3QuXG4gICAqL1xuICBzdGF0aWMgX21vZGVsTmVlZHNSZWxvYWQoe21vZGVsQ2xhc3MsIG1vZGVsLCBwcmVsb2FkLCBxdWVyeSwgZm9yY2V9KSB7XG4gICAgaWYgKGZvcmNlKSByZXR1cm4gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHByZWxvYWQpKSB7XG4gICAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcFNhdGlzZmllZCh7bW9kZWxDbGFzcywgbW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHN1YlByZWxvYWQ6IHByZWxvYWRbcmVsYXRpb25zaGlwTmFtZV0sIHF1ZXJ5fSkpIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQSByZWxhdGlvbnNoaXAgaXMgc2F0aXNmaWVkIHdoZW4gaXQgaXMgYWxyZWFkeSBwcmVsb2FkZWQsIGV2ZXJ5IHJlcXVpcmVkXG4gICAqIGBzZWxlY3RgIGF0dHJpYnV0ZSBpcyBwcmVzZW50IG9uIGVhY2ggbG9hZGVkIHRhcmdldCwgYW5kIGFueSBuZXN0ZWQgcHJlbG9hZFxuICAgKiBzdWItZ3JhcGggaXMgcmVjdXJzaXZlbHkgc2F0aXNmaWVkIG9uIHRob3NlIHRhcmdldHMuIGBzZWxlY3RzRXh0cmFgIGNhblxuICAgKiBuZXZlciBiZSBwcm92ZW4gc2F0aXNmaWVkIGZyb20gdGhlIGNhY2hlICh0aGUgYmFja2VuZCBzZXJpYWxpemVzIHRoZVxuICAgKiBjbGllbnQtdW5rbm93biBkZWZhdWx0IGF0dHJpYnV0ZXMgcGx1cyB0aGUgZXh0cmFzKSwgc28gaXQgYWx3YXlzIHJlbG9hZHMuXG4gICAqIFdpdGggbm8gc2VsZWN0IGFuZCBubyBuZXN0ZWQgcHJlbG9hZCwgYmVpbmcgcHJlbG9hZGVkIGlzIGVub3VnaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvd25pbmcgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZFtzdHJpbmddfSBhcmdzLnN1YlByZWxvYWQgLSBQcmVsb2FkIHZhbHVlIGZvciB0aGlzIHJlbGF0aW9uc2hpcCAoYHRydWVgIG9yIGEgbmVzdGVkIHJlY29yZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBhcmdzLnF1ZXJ5IC0gU291cmNlIHF1ZXJ5IGNhcnJ5aW5nIHNlbGVjdC9zZWxlY3RzRXh0cmEuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlbGF0aW9uc2hpcCBpcyBhbHJlYWR5IHNhdGlzZmllZC5cbiAgICovXG4gIHN0YXRpYyBfcmVsYXRpb25zaGlwU2F0aXNmaWVkKHttb2RlbENsYXNzLCBtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgc3ViUHJlbG9hZCwgcXVlcnl9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgbG9hZGVkID0gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gICAgY29uc3QgdGFyZ2V0cyA9IGxvYWRlZCA9PSBudWxsID8gW10gOiAoQXJyYXkuaXNBcnJheShsb2FkZWQpID8gbG9hZGVkIDogW2xvYWRlZF0pXG5cbiAgICBpZiAodGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxOYW1lID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICAvLyBgc2VsZWN0c0V4dHJhYCBzZXJpYWxpemVzIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZXMgKHVua25vd24gdG8gdGhlIGNsaWVudClcbiAgICAgIC8vIHBsdXMgdGhlIGV4dHJhcywgc28gYSBjYWNoZWQgdGFyZ2V0IGNhbid0IGJlIHByb3ZlbiBjb21wbGV0ZS5cbiAgICAgIGlmIChxdWVyeS5fc2VsZWN0c0V4dHJhW3RhcmdldE1vZGVsTmFtZV0pIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCByZXF1aXJlZCA9IHF1ZXJ5Ll9zZWxlY3RbdGFyZ2V0TW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHRhcmdldCBvZiB0YXJnZXRzKSB7XG4gICAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiByZXF1aXJlZCkge1xuICAgICAgICAgIGlmICghdGFyZ2V0Lmhhc0xvYWRlZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRQcmVsb2FkID0gdGhpcy5fbmVzdGVkUHJlbG9hZFJlY29yZChzdWJQcmVsb2FkKVxuXG4gICAgaWYgKG5lc3RlZFByZWxvYWQgJiYgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgdGFyZ2V0cykge1xuICAgICAgICBpZiAodGhpcy5fbW9kZWxOZWVkc1JlbG9hZCh7bW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcywgbW9kZWw6IHRhcmdldCwgcHJlbG9hZDogbmVzdGVkUHJlbG9hZCwgcXVlcnksIGZvcmNlOiBmYWxzZX0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmVzdGVkIHByZWxvYWQgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmRbc3RyaW5nXX0gc3ViUHJlbG9hZCAtIFByZWxvYWQgdmFsdWUgZm9yIGEgcmVsYXRpb25zaGlwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IC0gTmVzdGVkIHByZWxvYWQgcmVjb3JkLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm8gZGVlcGVyIGdyYXBoLlxuICAgKi9cbiAgc3RhdGljIF9uZXN0ZWRQcmVsb2FkUmVjb3JkKHN1YlByZWxvYWQpIHtcbiAgICBpZiAoIXN1YlByZWxvYWQgfHwgdHlwZW9mIHN1YlByZWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG4gICAgaWYgKE9iamVjdC5rZXlzKHN1YlByZWxvYWQpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovIChzdWJQcmVsb2FkKVxuICB9XG59XG4iXX0=