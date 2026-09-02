// @ts-check
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
        const primaryKey = modelClass.primaryKey();
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
            reloadedById.set(String(reloadedModel.primaryKeyValue()), reloadedModel);
        }
        for (const model of modelsToLoad) {
            const reloadedModel = reloadedById.get(String(model.primaryKeyValue()));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJlbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy9wcmVsb2FkZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsV0FBVyxFQUFFLEVBQUMsS0FBSyxHQUFHLEtBQUssRUFBQyxHQUFHLEVBQUU7UUFDNUQsSUFBSSxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTFDLE1BQU0sVUFBVSxHQUFHLHFEQUFxRCxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQ2hHLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSxPQUFPLFdBQVcsS0FBSyxRQUFRLElBQUksVUFBVSxJQUFJLFdBQVcsQ0FBQTtRQUNwRyxNQUFNLEtBQUssR0FBRyxPQUFPO1lBQ25CLENBQUMsQ0FBQyxtRkFBbUYsQ0FBQyxDQUFDLFdBQVcsQ0FBQztZQUNuRyxDQUFDLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUE7UUFFbEYsTUFBTSxxQkFBcUIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV6RCxJQUFJLHFCQUFxQixDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUU5QyxNQUFNLFlBQVksR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFFakksSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRXJDLE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUMxQyxNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQTtRQUVoRSx5RUFBeUU7UUFDekUsc0VBQXNFO1FBQ3RFLE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXRELFdBQVcsQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQTtRQUNuQyxXQUFXLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLENBQUE7UUFDL0MsV0FBVyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFBO1FBQ3pDLFdBQVcsQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQTtRQUN6QyxXQUFXLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUE7UUFDekMsV0FBVyxDQUFDLEtBQUssQ0FBQyxFQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQTtRQUV0QyxNQUFNLFFBQVEsR0FBRyxNQUFNLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUU1Qzs7OERBRXNEO1FBQ3RELE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFOUIsS0FBSyxNQUFNLGFBQWEsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNyQyxZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUMsRUFBRSxhQUFhLENBQUMsQ0FBQTtRQUMxRSxDQUFDO1FBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQyxNQUFNLGFBQWEsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxDQUFBO1lBRXZFLDBFQUEwRTtZQUMxRSxtRUFBbUU7WUFDbkUsSUFBSSxDQUFDLGFBQWE7Z0JBQUUsU0FBUTtZQUU1QixLQUFLLE1BQU0sZ0JBQWdCLElBQUkscUJBQXFCLEVBQUUsQ0FBQztnQkFDckQsTUFBTSxrQkFBa0IsR0FBRyxhQUFhLENBQUMscUJBQXFCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtnQkFDaEYsTUFBTSxrQkFBa0IsR0FBRyxLQUFLLENBQUMscUJBQXFCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtnQkFFeEUsa0JBQWtCLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFDdkQsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsTUFBTSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNqRSxJQUFJLEtBQUs7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV0QixLQUFLLE1BQU0sZ0JBQWdCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3BELElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxLQUFLLEVBQUMsQ0FBQztnQkFBRSxPQUFPLElBQUksQ0FBQTtRQUNwSSxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7O09BY0c7SUFDSCxNQUFNLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUM7UUFDcEYsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLHFCQUFxQixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFbEUsSUFBSSxDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU5QyxNQUFNLGdCQUFnQixHQUFHLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQzVFLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNwQyxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFFakYsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sZUFBZSxHQUFHLGdCQUFnQixDQUFDLFlBQVksRUFBRSxDQUFBO1lBRXZELDJFQUEyRTtZQUMzRSxnRUFBZ0U7WUFDaEUsSUFBSSxLQUFLLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUV0RCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUVyRCxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUM3QixLQUFLLE1BQU0sYUFBYSxJQUFJLFFBQVEsRUFBRSxDQUFDO29CQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQixDQUFDLGFBQWEsQ0FBQzt3QkFBRSxPQUFPLEtBQUssQ0FBQTtnQkFDN0QsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTNELElBQUksYUFBYSxJQUFJLGdCQUFnQixFQUFFLENBQUM7WUFDdEMsS0FBSyxNQUFNLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDN0IsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFDLENBQUMsRUFBRSxDQUFDO29CQUN2SCxPQUFPLEtBQUssQ0FBQTtnQkFDZCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLG9CQUFvQixDQUFDLFVBQVU7UUFDcEMsSUFBSSxDQUFDLFVBQVUsSUFBSSxPQUFPLFVBQVUsS0FBSyxRQUFRO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDOUQsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFckQsT0FBTyx1RUFBdUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQzdGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFByZWxvYWRzIHJlbGF0aW9uc2hpcHMgb250byBhbHJlYWR5LWxvYWRlZCBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKlxuICogVW5saWtlIHRoZSBiYWNrZW5kIE9STSBwcmVsb2FkZXIgKHdoaWNoIHF1ZXJpZXMgcmVsYXRpb25zaGlwIHRhYmxlc1xuICogZGlyZWN0bHkpLCB0aGUgZnJvbnRlbmQgcmUtZmV0Y2hlcyB0aGUgcGFyZW50IHJlY29yZHMgdGhyb3VnaCB0aGVpclxuICogYGluZGV4YCBlbmRwb2ludCB3aXRoIHRoZSBwcmVsb2FkL3NlbGVjdCBwYXJhbXMsIHRoZW4gY29waWVzIHRoZSByZXN1bHRpbmdcbiAqIHRvcC1sZXZlbCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcyBvbnRvIHRoZSBleGlzdGluZyBpbnN0YW5jZXMuIFJlbGF0aW9uc2hpcHNcbiAqIHRoYXQgYXJlIGFscmVhZHkgcHJlbG9hZGVkIHdpdGggdGhlIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBhcmUgc2tpcHBlZCxcbiAqIHNvIHJlcGVhdGVkIGNhbGxzIHJldXNlIHRoZSByZWxhdGlvbnNoaXAgY2FjaGUgaW5zdGVhZCBvZiBpc3N1aW5nIGR1cGxpY2F0ZVxuICogcmVxdWVzdHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxQcmVsb2FkZXIge1xuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0Pn0gbW9kZWxzIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzIHRvIHByZWxvYWQgb250by5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz4gfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gQSBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAsIG9yIGEgcmF3IHByZWxvYWQgc3BlYy5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwcmVsb2FkKG1vZGVscywgcXVlcnlPclNwZWMsIHtmb3JjZSA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCFtb2RlbHMgfHwgbW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSAqLyAobW9kZWxzWzBdLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGlzUXVlcnkgPSBCb29sZWFuKHF1ZXJ5T3JTcGVjKSAmJiB0eXBlb2YgcXVlcnlPclNwZWMgPT09IFwib2JqZWN0XCIgJiYgXCJfcHJlbG9hZFwiIGluIHF1ZXJ5T3JTcGVjXG4gICAgY29uc3QgcXVlcnkgPSBpc1F1ZXJ5XG4gICAgICA/IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAqLyAocXVlcnlPclNwZWMpXG4gICAgICA6IG1vZGVsQ2xhc3MucHJlbG9hZCgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocXVlcnlPclNwZWMpKVxuXG4gICAgY29uc3QgdG9wTGV2ZWxSZWxhdGlvbnNoaXBzID0gT2JqZWN0LmtleXMocXVlcnkuX3ByZWxvYWQpXG5cbiAgICBpZiAodG9wTGV2ZWxSZWxhdGlvbnNoaXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbHNUb0xvYWQgPSBtb2RlbHMuZmlsdGVyKChtb2RlbCkgPT4gdGhpcy5fbW9kZWxOZWVkc1JlbG9hZCh7bW9kZWxDbGFzcywgbW9kZWwsIHByZWxvYWQ6IHF1ZXJ5Ll9wcmVsb2FkLCBxdWVyeSwgZm9yY2V9KSlcblxuICAgIGlmIChtb2RlbHNUb0xvYWQubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGlkcyA9IG1vZGVsc1RvTG9hZC5tYXAoKG1vZGVsKSA9PiBtb2RlbC5wcmltYXJ5S2V5VmFsdWUoKSlcblxuICAgIC8vIFJlYnVpbGQgYSBmcmVzaCBxdWVyeSBjYXJyeWluZyBvbmx5IHRoZSBwcm9qZWN0aW9uLXJlbGV2YW50IHN0YXRlIHNvIGFcbiAgICAvLyB1c2VyLXN1cHBsaWVkIGxpbWl0L3NvcnQvd2hlcmUgb24gdGhlIHNvdXJjZSBxdWVyeSBkb2Vzbid0IGxlYWsgaW4uXG4gICAgY29uc3QgcmVsb2FkUXVlcnkgPSBtb2RlbENsYXNzLnByZWxvYWQocXVlcnkuX3ByZWxvYWQpXG5cbiAgICByZWxvYWRRdWVyeS5fc2VsZWN0ID0gcXVlcnkuX3NlbGVjdFxuICAgIHJlbG9hZFF1ZXJ5Ll9zZWxlY3RzRXh0cmEgPSBxdWVyeS5fc2VsZWN0c0V4dHJhXG4gICAgcmVsb2FkUXVlcnkuX3dpdGhDb3VudCA9IHF1ZXJ5Ll93aXRoQ291bnRcbiAgICByZWxvYWRRdWVyeS5fYWJpbGl0aWVzID0gcXVlcnkuX2FiaWxpdGllc1xuICAgIHJlbG9hZFF1ZXJ5Ll9xdWVyeURhdGEgPSBxdWVyeS5fcXVlcnlEYXRhXG4gICAgcmVsb2FkUXVlcnkud2hlcmUoe1twcmltYXJ5S2V5XTogaWRzfSlcblxuICAgIGNvbnN0IHJlbG9hZGVkID0gYXdhaXQgcmVsb2FkUXVlcnkudG9BcnJheSgpXG5cbiAgICAvKipcbiAgICAgKiBSZWxvYWRlZCBieSBpZC5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IHJlbG9hZGVkQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxvYWRlZE1vZGVsIG9mIHJlbG9hZGVkKSB7XG4gICAgICByZWxvYWRlZEJ5SWQuc2V0KFN0cmluZyhyZWxvYWRlZE1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKSwgcmVsb2FkZWRNb2RlbClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVsc1RvTG9hZCkge1xuICAgICAgY29uc3QgcmVsb2FkZWRNb2RlbCA9IHJlbG9hZGVkQnlJZC5nZXQoU3RyaW5nKG1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKSlcblxuICAgICAgLy8gVGhlIHJlY29yZCBtYXkgaGF2ZSBiZWVuIGRlbGV0ZWQvZmlsdGVyZWQgYmV0d2VlbiB0aGUgb3JpZ2luYWwgbG9hZCBhbmRcbiAgICAgIC8vIHRoaXMgcHJlbG9hZCDigJQgc2tpcCBpdCByYXRoZXIgdGhhbiBjcmFzaGluZyBvbiBhIG1pc3NpbmcgcmVsb2FkLlxuICAgICAgaWYgKCFyZWxvYWRlZE1vZGVsKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgdG9wTGV2ZWxSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGNvbnN0IHNvdXJjZVJlbGF0aW9uc2hpcCA9IHJlbG9hZGVkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IHRhcmdldFJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICAgIHRhcmdldFJlbGF0aW9uc2hpcC5jb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmVlZHMgcmVsb2FkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRoZSBwcmVsb2FkIGdyYXBoIGlzIHJvb3RlZCBhdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IGFyZ3MucHJlbG9hZCAtIFByZWxvYWQgc3ViLWdyYXBoIHRvIHNhdGlzZnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBhcmdzLnF1ZXJ5IC0gU291cmNlIHF1ZXJ5IGNhcnJ5aW5nIHNlbGVjdC9zZWxlY3RzRXh0cmEuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5mb3JjZSAtIFdoZXRoZXIgdG8gcmVsb2FkIHJlZ2FyZGxlc3Mgb2YgY2FjaGVkIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBuZWVkcyBhIHJlbG9hZCByZXF1ZXN0LlxuICAgKi9cbiAgc3RhdGljIF9tb2RlbE5lZWRzUmVsb2FkKHttb2RlbENsYXNzLCBtb2RlbCwgcHJlbG9hZCwgcXVlcnksIGZvcmNlfSkge1xuICAgIGlmIChmb3JjZSkgcmV0dXJuIHRydWVcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhwcmVsb2FkKSkge1xuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBTYXRpc2ZpZWQoe21vZGVsQ2xhc3MsIG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCBzdWJQcmVsb2FkOiBwcmVsb2FkW3JlbGF0aW9uc2hpcE5hbWVdLCBxdWVyeX0pKSByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEEgcmVsYXRpb25zaGlwIGlzIHNhdGlzZmllZCB3aGVuIGl0IGlzIGFscmVhZHkgcHJlbG9hZGVkLCBldmVyeSByZXF1aXJlZFxuICAgKiBgc2VsZWN0YCBhdHRyaWJ1dGUgaXMgcHJlc2VudCBvbiBlYWNoIGxvYWRlZCB0YXJnZXQsIGFuZCBhbnkgbmVzdGVkIHByZWxvYWRcbiAgICogc3ViLWdyYXBoIGlzIHJlY3Vyc2l2ZWx5IHNhdGlzZmllZCBvbiB0aG9zZSB0YXJnZXRzLiBgc2VsZWN0c0V4dHJhYCBjYW5cbiAgICogbmV2ZXIgYmUgcHJvdmVuIHNhdGlzZmllZCBmcm9tIHRoZSBjYWNoZSAodGhlIGJhY2tlbmQgc2VyaWFsaXplcyB0aGVcbiAgICogY2xpZW50LXVua25vd24gZGVmYXVsdCBhdHRyaWJ1dGVzIHBsdXMgdGhlIGV4dHJhcyksIHNvIGl0IGFsd2F5cyByZWxvYWRzLlxuICAgKiBXaXRoIG5vIHNlbGVjdCBhbmQgbm8gbmVzdGVkIHByZWxvYWQsIGJlaW5nIHByZWxvYWRlZCBpcyBlbm91Z2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmRbc3RyaW5nXX0gYXJncy5zdWJQcmVsb2FkIC0gUHJlbG9hZCB2YWx1ZSBmb3IgdGhpcyByZWxhdGlvbnNoaXAgKGB0cnVlYCBvciBhIG5lc3RlZCByZWNvcmQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gYXJncy5xdWVyeSAtIFNvdXJjZSBxdWVyeSBjYXJyeWluZyBzZWxlY3Qvc2VsZWN0c0V4dHJhLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgaXMgYWxyZWFkeSBzYXRpc2ZpZWQuXG4gICAqL1xuICBzdGF0aWMgX3JlbGF0aW9uc2hpcFNhdGlzZmllZCh7bW9kZWxDbGFzcywgbW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHN1YlByZWxvYWQsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgIGNvbnN0IHRhcmdldHMgPSBsb2FkZWQgPT0gbnVsbCA/IFtdIDogKEFycmF5LmlzQXJyYXkobG9hZGVkKSA/IGxvYWRlZCA6IFtsb2FkZWRdKVxuXG4gICAgaWYgKHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsTmFtZSA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgLy8gYHNlbGVjdHNFeHRyYWAgc2VyaWFsaXplcyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGVzICh1bmtub3duIHRvIHRoZSBjbGllbnQpXG4gICAgICAvLyBwbHVzIHRoZSBleHRyYXMsIHNvIGEgY2FjaGVkIHRhcmdldCBjYW4ndCBiZSBwcm92ZW4gY29tcGxldGUuXG4gICAgICBpZiAocXVlcnkuX3NlbGVjdHNFeHRyYVt0YXJnZXRNb2RlbE5hbWVdKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgcmVxdWlyZWQgPSBxdWVyeS5fc2VsZWN0W3RhcmdldE1vZGVsTmFtZV0gfHwgW11cblxuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgdGFyZ2V0cykge1xuICAgICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgcmVxdWlyZWQpIHtcbiAgICAgICAgICBpZiAoIXRhcmdldC5oYXNMb2FkZWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkUHJlbG9hZCA9IHRoaXMuX25lc3RlZFByZWxvYWRSZWNvcmQoc3ViUHJlbG9hZClcblxuICAgIGlmIChuZXN0ZWRQcmVsb2FkICYmIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICAgICAgaWYgKHRoaXMuX21vZGVsTmVlZHNSZWxvYWQoe21vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsIG1vZGVsOiB0YXJnZXQsIHByZWxvYWQ6IG5lc3RlZFByZWxvYWQsIHF1ZXJ5LCBmb3JjZTogZmFsc2V9KSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5lc3RlZCBwcmVsb2FkIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkW3N0cmluZ119IHN1YlByZWxvYWQgLSBQcmVsb2FkIHZhbHVlIGZvciBhIHJlbGF0aW9uc2hpcC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsfSAtIE5lc3RlZCBwcmVsb2FkIHJlY29yZCwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vIGRlZXBlciBncmFwaC5cbiAgICovXG4gIHN0YXRpYyBfbmVzdGVkUHJlbG9hZFJlY29yZChzdWJQcmVsb2FkKSB7XG4gICAgaWYgKCFzdWJQcmVsb2FkIHx8IHR5cGVvZiBzdWJQcmVsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuICAgIGlmIChPYmplY3Qua2V5cyhzdWJQcmVsb2FkKS5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqLyAoc3ViUHJlbG9hZClcbiAgfVxufVxuIl19