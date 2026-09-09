// @ts-check
import { scalarModelPrimaryKey } from "../../utils/model-primary-key.js";
/**
 * WithCountEntry type.
 * @typedef {object} WithCountEntry
 * @property {string} attributeName - Attribute to set on each parent record holding the count.
 * @property {string} relationshipName - Has-many relationship whose rows are counted.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | undefined} where - Optional extra where clause applied to the count query.
 */
/**
 * Defines this typedef.
 * @typedef {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} WithCountSpec
 */
/**
 * Normalize the flexible user-facing `.withCount(...)` argument into the
 * strict internal list of {attributeName, relationshipName, where} entries
 * the runner consumes.
 *
 * Accepted shapes:
 *   "projects"                                         → one entry
 *   ["projects", "timelogs"]                           → one entry per name
 *   {projects: true}                                   → one entry (attr = "projectsCount")
 *   {activeMembersCount:                               → custom attribute name
 *     {relationship: "users", where: {active: true}}}
 * @param {WithCountSpec} spec - User-supplied spec.
 * @returns {WithCountEntry[]} - Normalized entries.
 */
export function normalizeWithCount(spec) {
    if (spec == null)
        return [];
    if (typeof spec === "string") {
        return [entryFromName(spec)];
    }
    if (Array.isArray(spec)) {
        return spec.flatMap((item) => {
            if (typeof item !== "string") {
                throw new Error(`withCount array entries must be strings; got ${typeof item}`);
            }
            return entryFromName(item);
        });
    }
    if (typeof spec === "object") {
        /**
         * Entries.
         * @type {WithCountEntry[]} */
        const entries = [];
        for (const [key, value] of Object.entries(spec)) {
            if (value === true) {
                entries.push(entryFromName(key));
                continue;
            }
            if (value === false) {
                continue;
            }
            if (typeof value === "object" && value !== null) {
                /**
                 * Options.
                 * @type {{relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}} */
                const options = value;
                entries.push({
                    attributeName: key,
                    relationshipName: options.relationship || key,
                    where: options.where
                });
                continue;
            }
            throw new Error(`Invalid withCount value for ${key}: ${typeof value}`);
        }
        return entries;
    }
    throw new Error(`Invalid withCount spec: ${typeof spec}`);
}
/**
 * Runs entry from name.
 * @param {string} name - Relationship name (attribute name is derived by appending "Count").
 * @returns {WithCountEntry} - Normalized association-count entry.
 */
function entryFromName(name) {
    return {
        attributeName: `${name}Count`,
        relationshipName: name,
        where: undefined
    };
}
/**
 * Run every withCount entry against the loaded parent records, attaching
 * the resulting counts as attributes on each record. Mirrors the
 * Preloader's data-flow shape — one grouped count query per entry, then
 * `setAttribute` on each parent.
 * @param {object} args - Options.
 * @param {import("../record/index.js").default[]} args.models - Loaded parent records.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {WithCountEntry[]} args.entries - Normalized withCount entries.
 * @returns {Promise<void>}
 */
export async function runWithCount({ models, modelClass, entries }) {
    if (models.length === 0 || entries.length === 0)
        return;
    const primaryKey = scalarModelPrimaryKey(modelClass.primaryKey(), `withCount for ${modelClass.name}`);
    const parentIds = models.map((model) => /** @type {string | number} */ (model.readColumn(primaryKey)));
    const sourceModel = models[0];
    const queryGroups = new Map();
    for (const entry of entries) {
        const { baseQuery, foreignKey } = queryForEntry({ entry, modelClass, sourceModel });
        const sql = baseQuery.toSql();
        const existingGroup = queryGroups.get(sql);
        if (existingGroup) {
            existingGroup.entries.push(entry);
        }
        else {
            queryGroups.set(sql, { baseQuery, entries: [entry], foreignKey });
        }
    }
    for (const { baseQuery, entries: groupedEntries, foreignKey } of queryGroups.values()) {
        const counts = await executeChunkedCountQuery({ baseQuery, foreignKey, parentIds });
        for (const entry of groupedEntries)
            attachCounts({ counts, entry, models, primaryKey });
    }
}
/**
 * Builds the grouped count query for an entry.
 *
 * The returned query does NOT yet filter by parent IDs; callers chunk the
 * parent cohort and apply the foreign-key IN clause per chunk.
 * @param {object} args - Options.
 * @param {WithCountEntry} args.entry - Entry being evaluated.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {import("../record/index.js").default} args.sourceModel - Loaded operation owner.
 * @returns {{baseQuery: import("./model-class-query.js").default, foreignKey: string}} - Prepared count query and its foreign key.
 */
function queryForEntry({ entry, modelClass, sourceModel }) {
    const relationship = modelClass.getRelationshipByName(entry.relationshipName);
    if (!relationship) {
        throw new Error(`${modelClass.name} has no relationship named ${JSON.stringify(entry.relationshipName)} (withCount attribute ${JSON.stringify(entry.attributeName)})`);
    }
    if (relationship.type !== "hasMany") {
        throw new Error(`withCount currently supports only hasMany relationships; ${modelClass.name}#${entry.relationshipName} is ${relationship.type}`);
    }
    const rawTargetModelClass = relationship.getTargetModelClass();
    if (!rawTargetModelClass) {
        throw new Error(`withCount: could not resolve target model for ${modelClass.name}#${entry.relationshipName}`);
    }
    const targetModelClass = modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
    const foreignKey = relationship.getForeignKeyForModelClasses({ modelClass, targetModelClass });
    /**
     * Mandatory cohort conditions.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const mandatoryWhereConditions = {};
    if (relationship.getPolymorphic && relationship.getPolymorphic()) {
        const typeColumn = relationship.getPolymorphicTypeColumn();
        mandatoryWhereConditions[typeColumn] = modelClass.getModelName();
    }
    const baseQuery = sourceModel.queryForModel(targetModelClass);
    baseQuery._forceQualifyBaseTable = true;
    if (Object.keys(mandatoryWhereConditions).length > 0) {
        baseQuery.where(mandatoryWhereConditions);
    }
    if (entry.where) {
        baseQuery.where(entry.where);
    }
    const countQuery = relationship.applyScope(baseQuery);
    countQuery._preload = {};
    countQuery.reselect();
    const driver = countQuery.driver;
    const quotedTable = driver.quoteTable(countQuery.rootTableReference());
    const quotedFk = driver.quoteColumn(foreignKey);
    const qualifiedForeignKey = `${quotedTable}.${quotedFk}`;
    countQuery.group(qualifiedForeignKey);
    countQuery.select(`${qualifiedForeignKey} AS parent_id`);
    countQuery.select("COUNT(*) AS count_value");
    return { baseQuery: countQuery, foreignKey };
}
/**
 * Executes a prepared grouped count query.
 * @param {import("./model-class-query.js").default} countQuery - Prepared count query.
 * @returns {Promise<Map<string | number, number>>} - Map of parent pk → count.
 */
async function executeCountQuery(countQuery) {
    const rows = /** @type {Array<{parent_id: string | number, count_value: string | number}>} */ (await countQuery._executeQuery());
    /**
     * Counts.
     * @type {Map<string | number, number>} */
    const counts = new Map();
    for (const row of rows) {
        const parentId = /** @type {string | number} */ (row.parent_id);
        const countValue = Number(row.count_value) || 0;
        counts.set(parentId, countValue);
    }
    return counts;
}
/**
 * Executes a grouped count query in cohorts so the parent ID IN-list stays
 * within driver limits, merging per-parent counts across chunks.
 * @param {object} args - Options.
 * @param {import("./model-class-query.js").default} args.baseQuery - Prepared count query without parent IDs.
 * @param {string} args.foreignKey - Foreign key used to join to the parents.
 * @param {Array<string | number>} args.parentIds - Primary keys of the loaded parents.
 * @returns {Promise<Map<string | number, number>>} - Map of parent pk → count.
 */
async function executeChunkedCountQuery({ baseQuery, foreignKey, parentIds }) {
    const driver = baseQuery.driver;
    const cohorts = driver.chunkValues(parentIds, (chunk) => baseQuery.clone().where({ [foreignKey]: chunk }).toSql());
    /**
     * Counts.
     * @type {Map<string | number, number>} */
    const counts = new Map();
    for (const cohort of cohorts) {
        const cohortQuery = baseQuery.clone().where({ [foreignKey]: cohort });
        const cohortCounts = await executeCountQuery(cohortQuery);
        for (const [parentId, count] of cohortCounts) {
            counts.set(parentId, count);
        }
    }
    return counts;
}
/**
 * Attaches one entry's resolved counts to the loaded models.
 * @param {object} args - Options.
 * @param {Map<string | number, number>} args.counts - Counts keyed by parent primary key.
 * @param {WithCountEntry} args.entry - Entry whose alias receives the counts.
 * @param {import("../record/index.js").default[]} args.models - Loaded parent records.
 * @param {string} args.primaryKey - Parent primary key column.
 * @returns {void}
 */
function attachCounts({ counts, entry, models, primaryKey }) {
    for (const model of models) {
        const modelPrimaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey));
        // Tolerate driver differences in numeric return types: SQLite
        // returns integers as JS numbers, but MySQL's raw driver can
        // return count primary keys as strings. Try both.
        const resolvedCount = counts.has(modelPrimaryKeyValue)
            ? /** @type {number} */ (counts.get(modelPrimaryKeyValue))
            : Number(counts.get(String(modelPrimaryKeyValue)) ?? 0);
        // Counts go on the record's dedicated association-count map,
        // NOT on `_attributes`, so a virtual `tasksCount` can't shadow a
        // real `tasks_count` column (e.g. a counter_cache) nor leak into
        // attribute-level serialization / change tracking.
        model._setAssociationCount(entry.attributeName, resolvedCount);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2l0aC1jb3VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aXRoLWNvdW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMscUJBQXFCLEVBQUMsTUFBTSxrQ0FBa0MsQ0FBQTtBQUV0RTs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsTUFBTSxVQUFVLGtCQUFrQixDQUFDLElBQUk7SUFDckMsSUFBSSxJQUFJLElBQUksSUFBSTtRQUFFLE9BQU8sRUFBRSxDQUFBO0lBRTNCLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDN0IsT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0lBQzlCLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN4QixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRTtZQUMzQixJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxPQUFPLElBQUksRUFBRSxDQUFDLENBQUE7WUFDaEYsQ0FBQztZQUVELE9BQU8sYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzVCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVELElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDN0I7O3NDQUU4QjtRQUM5QixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFFbEIsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNoRCxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQztn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TSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUV6RCw2REFBNkQ7UUFDN0QsaUVBQWlFO1FBQ2pFLGlFQUFpRTtRQUNqRSxtREFBbUQ7UUFDbkQsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFDaEUsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogV2l0aENvdW50RW50cnkgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdpdGhDb3VudEVudHJ5XG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0byBzZXQgb24gZWFjaCBwYXJlbnQgcmVjb3JkIGhvbGRpbmcgdGhlIGNvdW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBIYXMtbWFueSByZWxhdGlvbnNoaXAgd2hvc2Ugcm93cyBhcmUgY291bnRlZC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSB3aGVyZSAtIE9wdGlvbmFsIGV4dHJhIHdoZXJlIGNsYXVzZSBhcHBsaWVkIHRvIHRoZSBjb3VudCBxdWVyeS5cbiAqL1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3N0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IFdpdGhDb3VudFNwZWNcbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZSB0aGUgZmxleGlibGUgdXNlci1mYWNpbmcgYC53aXRoQ291bnQoLi4uKWAgYXJndW1lbnQgaW50byB0aGVcbiAqIHN0cmljdCBpbnRlcm5hbCBsaXN0IG9mIHthdHRyaWJ1dGVOYW1lLCByZWxhdGlvbnNoaXBOYW1lLCB3aGVyZX0gZW50cmllc1xuICogdGhlIHJ1bm5lciBjb25zdW1lcy5cbiAqXG4gKiBBY2NlcHRlZCBzaGFwZXM6XG4gKiAgIFwicHJvamVjdHNcIiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaSIG9uZSBlbnRyeVxuICogICBbXCJwcm9qZWN0c1wiLCBcInRpbWVsb2dzXCJdICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaSIG9uZSBlbnRyeSBwZXIgbmFtZVxuICogICB7cHJvamVjdHM6IHRydWV9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDihpIgb25lIGVudHJ5IChhdHRyID0gXCJwcm9qZWN0c0NvdW50XCIpXG4gKiAgIHthY3RpdmVNZW1iZXJzQ291bnQ6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBjdXN0b20gYXR0cmlidXRlIG5hbWVcbiAqICAgICB7cmVsYXRpb25zaGlwOiBcInVzZXJzXCIsIHdoZXJlOiB7YWN0aXZlOiB0cnVlfX19XG4gKiBAcGFyYW0ge1dpdGhDb3VudFNwZWN9IHNwZWMgLSBVc2VyLXN1cHBsaWVkIHNwZWMuXG4gKiBAcmV0dXJucyB7V2l0aENvdW50RW50cnlbXX0gLSBOb3JtYWxpemVkIGVudHJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVXaXRoQ291bnQoc3BlYykge1xuICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW2VudHJ5RnJvbU5hbWUoc3BlYyldXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzcGVjKSkge1xuICAgIHJldHVybiBzcGVjLmZsYXRNYXAoKGl0ZW0pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgaXRlbSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhDb3VudCBhcnJheSBlbnRyaWVzIG11c3QgYmUgc3RyaW5nczsgZ290ICR7dHlwZW9mIGl0ZW19YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGVudHJ5RnJvbU5hbWUoaXRlbSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHR5cGVvZiBzcGVjID09PSBcIm9iamVjdFwiKSB7XG4gICAgLyoqXG4gICAgICogRW50cmllcy5cbiAgICAgKiBAdHlwZSB7V2l0aENvdW50RW50cnlbXX0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMpKSB7XG4gICAgICBpZiAodmFsdWUgPT09IHRydWUpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKGVudHJ5RnJvbU5hbWUoa2V5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPcHRpb25zLlxuICAgICAgICAgKiBAdHlwZSB7e3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqL1xuICAgICAgICBjb25zdCBvcHRpb25zID0gdmFsdWVcbiAgICAgICAgZW50cmllcy5wdXNoKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBrZXksXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogb3B0aW9ucy5yZWxhdGlvbnNoaXAgfHwga2V5LFxuICAgICAgICAgIHdoZXJlOiBvcHRpb25zLndoZXJlXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB3aXRoQ291bnQgdmFsdWUgZm9yICR7a2V5fTogJHt0eXBlb2YgdmFsdWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHdpdGhDb3VudCBzcGVjOiAke3R5cGVvZiBzcGVjfWApXG59XG5cbi8qKlxuICogUnVucyBlbnRyeSBmcm9tIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIChhdHRyaWJ1dGUgbmFtZSBpcyBkZXJpdmVkIGJ5IGFwcGVuZGluZyBcIkNvdW50XCIpLlxuICogQHJldHVybnMge1dpdGhDb3VudEVudHJ5fSAtIE5vcm1hbGl6ZWQgYXNzb2NpYXRpb24tY291bnQgZW50cnkuXG4gKi9cbmZ1bmN0aW9uIGVudHJ5RnJvbU5hbWUobmFtZSkge1xuICByZXR1cm4ge1xuICAgIGF0dHJpYnV0ZU5hbWU6IGAke25hbWV9Q291bnRgLFxuICAgIHJlbGF0aW9uc2hpcE5hbWU6IG5hbWUsXG4gICAgd2hlcmU6IHVuZGVmaW5lZFxuICB9XG59XG5cbi8qKlxuICogUnVuIGV2ZXJ5IHdpdGhDb3VudCBlbnRyeSBhZ2FpbnN0IHRoZSBsb2FkZWQgcGFyZW50IHJlY29yZHMsIGF0dGFjaGluZ1xuICogdGhlIHJlc3VsdGluZyBjb3VudHMgYXMgYXR0cmlidXRlcyBvbiBlYWNoIHJlY29yZC4gTWlycm9ycyB0aGVcbiAqIFByZWxvYWRlcidzIGRhdGEtZmxvdyBzaGFwZSDigJQgb25lIGdyb3VwZWQgY291bnQgcXVlcnkgcGVyIGVudHJ5LCB0aGVuXG4gKiBgc2V0QXR0cmlidXRlYCBvbiBlYWNoIHBhcmVudC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5tb2RlbHMgLSBMb2FkZWQgcGFyZW50IHJlY29yZHMuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtXaXRoQ291bnRFbnRyeVtdfSBhcmdzLmVudHJpZXMgLSBOb3JtYWxpemVkIHdpdGhDb3VudCBlbnRyaWVzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5XaXRoQ291bnQoe21vZGVscywgbW9kZWxDbGFzcywgZW50cmllc30pIHtcbiAgaWYgKG1vZGVscy5sZW5ndGggPT09IDAgfHwgZW50cmllcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkobW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGB3aXRoQ291bnQgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gIGNvbnN0IHBhcmVudElkcyA9IG1vZGVscy5tYXAoKG1vZGVsKSA9PiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpKVxuICBjb25zdCBzb3VyY2VNb2RlbCA9IG1vZGVsc1swXVxuICBjb25zdCBxdWVyeUdyb3VwcyA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGNvbnN0IHtiYXNlUXVlcnksIGZvcmVpZ25LZXl9ID0gcXVlcnlGb3JFbnRyeSh7ZW50cnksIG1vZGVsQ2xhc3MsIHNvdXJjZU1vZGVsfSlcbiAgICBjb25zdCBzcWwgPSBiYXNlUXVlcnkudG9TcWwoKVxuICAgIGNvbnN0IGV4aXN0aW5nR3JvdXAgPSBxdWVyeUdyb3Vwcy5nZXQoc3FsKVxuXG4gICAgaWYgKGV4aXN0aW5nR3JvdXApIHtcbiAgICAgIGV4aXN0aW5nR3JvdXAuZW50cmllcy5wdXNoKGVudHJ5KVxuICAgIH0gZWxzZSB7XG4gICAgICBxdWVyeUdyb3Vwcy5zZXQoc3FsLCB7YmFzZVF1ZXJ5LCBlbnRyaWVzOiBbZW50cnldLCBmb3JlaWduS2V5fSlcbiAgICB9XG4gIH1cblxuICBmb3IgKGNvbnN0IHtiYXNlUXVlcnksIGVudHJpZXM6IGdyb3VwZWRFbnRyaWVzLCBmb3JlaWduS2V5fSBvZiBxdWVyeUdyb3Vwcy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGNvdW50cyA9IGF3YWl0IGV4ZWN1dGVDaHVua2VkQ291bnRRdWVyeSh7YmFzZVF1ZXJ5LCBmb3JlaWduS2V5LCBwYXJlbnRJZHN9KVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBncm91cGVkRW50cmllcykgYXR0YWNoQ291bnRzKHtjb3VudHMsIGVudHJ5LCBtb2RlbHMsIHByaW1hcnlLZXl9KVxuICB9XG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSBncm91cGVkIGNvdW50IHF1ZXJ5IGZvciBhbiBlbnRyeS5cbiAqXG4gKiBUaGUgcmV0dXJuZWQgcXVlcnkgZG9lcyBOT1QgeWV0IGZpbHRlciBieSBwYXJlbnQgSURzOyBjYWxsZXJzIGNodW5rIHRoZVxuICogcGFyZW50IGNvaG9ydCBhbmQgYXBwbHkgdGhlIGZvcmVpZ24ta2V5IElOIGNsYXVzZSBwZXIgY2h1bmsuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1dpdGhDb3VudEVudHJ5fSBhcmdzLmVudHJ5IC0gRW50cnkgYmVpbmcgZXZhbHVhdGVkLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIFBhcmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3Muc291cmNlTW9kZWwgLSBMb2FkZWQgb3BlcmF0aW9uIG93bmVyLlxuICogQHJldHVybnMge3tiYXNlUXVlcnk6IGltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCwgZm9yZWlnbktleTogc3RyaW5nfX0gLSBQcmVwYXJlZCBjb3VudCBxdWVyeSBhbmQgaXRzIGZvcmVpZ24ga2V5LlxuICovXG5mdW5jdGlvbiBxdWVyeUZvckVudHJ5KHtlbnRyeSwgbW9kZWxDbGFzcywgc291cmNlTW9kZWx9KSB7XG4gIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bW9kZWxDbGFzcy5uYW1lfSBoYXMgbm8gcmVsYXRpb25zaGlwIG5hbWVkICR7SlNPTi5zdHJpbmdpZnkoZW50cnkucmVsYXRpb25zaGlwTmFtZSl9ICh3aXRoQ291bnQgYXR0cmlidXRlICR7SlNPTi5zdHJpbmdpZnkoZW50cnkuYXR0cmlidXRlTmFtZSl9KWApXG4gIH1cblxuICBpZiAocmVsYXRpb25zaGlwLnR5cGUgIT09IFwiaGFzTWFueVwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoQ291bnQgY3VycmVudGx5IHN1cHBvcnRzIG9ubHkgaGFzTWFueSByZWxhdGlvbnNoaXBzOyAke21vZGVsQ2xhc3MubmFtZX0jJHtlbnRyeS5yZWxhdGlvbnNoaXBOYW1lfSBpcyAke3JlbGF0aW9uc2hpcC50eXBlfWApXG4gIH1cblxuICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRocm93IG5ldyBFcnJvcihgd2l0aENvdW50OiBjb3VsZCBub3QgcmVzb2x2ZSB0YXJnZXQgbW9kZWwgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke2VudHJ5LnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgfVxuXG4gIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MocmF3VGFyZ2V0TW9kZWxDbGFzcylcbiAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5Rm9yTW9kZWxDbGFzc2VzKHttb2RlbENsYXNzLCB0YXJnZXRNb2RlbENsYXNzfSlcbiAgLyoqXG4gICAqIE1hbmRhdG9yeSBjb2hvcnQgY29uZGl0aW9ucy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgbWFuZGF0b3J5V2hlcmVDb25kaXRpb25zID0ge31cblxuICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljICYmIHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuICAgIG1hbmRhdG9yeVdoZXJlQ29uZGl0aW9uc1t0eXBlQ29sdW1uXSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgfVxuXG4gIGNvbnN0IGJhc2VRdWVyeSA9IHNvdXJjZU1vZGVsLnF1ZXJ5Rm9yTW9kZWwodGFyZ2V0TW9kZWxDbGFzcylcblxuICBiYXNlUXVlcnkuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZSA9IHRydWVcblxuICBpZiAoT2JqZWN0LmtleXMobWFuZGF0b3J5V2hlcmVDb25kaXRpb25zKS5sZW5ndGggPiAwKSB7XG4gICAgYmFzZVF1ZXJ5LndoZXJlKG1hbmRhdG9yeVdoZXJlQ29uZGl0aW9ucylcbiAgfVxuXG4gIGlmIChlbnRyeS53aGVyZSkge1xuICAgIGJhc2VRdWVyeS53aGVyZShlbnRyeS53aGVyZSlcbiAgfVxuXG4gIGNvbnN0IGNvdW50UXVlcnkgPSByZWxhdGlvbnNoaXAuYXBwbHlTY29wZShiYXNlUXVlcnkpXG5cbiAgY291bnRRdWVyeS5fcHJlbG9hZCA9IHt9XG4gIGNvdW50UXVlcnkucmVzZWxlY3QoKVxuXG4gIGNvbnN0IGRyaXZlciA9IGNvdW50UXVlcnkuZHJpdmVyXG4gIGNvbnN0IHF1b3RlZFRhYmxlID0gZHJpdmVyLnF1b3RlVGFibGUoY291bnRRdWVyeS5yb290VGFibGVSZWZlcmVuY2UoKSlcbiAgY29uc3QgcXVvdGVkRmsgPSBkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleSlcbiAgY29uc3QgcXVhbGlmaWVkRm9yZWlnbktleSA9IGAke3F1b3RlZFRhYmxlfS4ke3F1b3RlZEZrfWBcblxuICBjb3VudFF1ZXJ5Lmdyb3VwKHF1YWxpZmllZEZvcmVpZ25LZXkpXG4gIGNvdW50UXVlcnkuc2VsZWN0KGAke3F1YWxpZmllZEZvcmVpZ25LZXl9IEFTIHBhcmVudF9pZGApXG4gIGNvdW50UXVlcnkuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRfdmFsdWVcIilcblxuICByZXR1cm4ge2Jhc2VRdWVyeTogY291bnRRdWVyeSwgZm9yZWlnbktleX1cbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIHByZXBhcmVkIGdyb3VwZWQgY291bnQgcXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gY291bnRRdWVyeSAtIFByZXBhcmVkIGNvdW50IHF1ZXJ5LlxuICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZyB8IG51bWJlciwgbnVtYmVyPj59IC0gTWFwIG9mIHBhcmVudCBwayDihpIgY291bnQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVDb3VudFF1ZXJ5KGNvdW50UXVlcnkpIHtcbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7QXJyYXk8e3BhcmVudF9pZDogc3RyaW5nIHwgbnVtYmVyLCBjb3VudF92YWx1ZTogc3RyaW5nIHwgbnVtYmVyfT59ICovIChcbiAgICBhd2FpdCBjb3VudFF1ZXJ5Ll9leGVjdXRlUXVlcnkoKVxuICApXG5cbiAgLyoqXG4gICAqIENvdW50cy5cbiAgICogQHR5cGUge01hcDxzdHJpbmcgfCBudW1iZXIsIG51bWJlcj59ICovXG4gIGNvbnN0IGNvdW50cyA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBwYXJlbnRJZCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAocm93LnBhcmVudF9pZClcbiAgICBjb25zdCBjb3VudFZhbHVlID0gTnVtYmVyKHJvdy5jb3VudF92YWx1ZSkgfHwgMFxuICAgIGNvdW50cy5zZXQocGFyZW50SWQsIGNvdW50VmFsdWUpXG4gIH1cblxuICByZXR1cm4gY291bnRzXG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBncm91cGVkIGNvdW50IHF1ZXJ5IGluIGNvaG9ydHMgc28gdGhlIHBhcmVudCBJRCBJTi1saXN0IHN0YXlzXG4gKiB3aXRoaW4gZHJpdmVyIGxpbWl0cywgbWVyZ2luZyBwZXItcGFyZW50IGNvdW50cyBhY3Jvc3MgY2h1bmtzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MuYmFzZVF1ZXJ5IC0gUHJlcGFyZWQgY291bnQgcXVlcnkgd2l0aG91dCBwYXJlbnQgSURzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZm9yZWlnbktleSAtIEZvcmVpZ24ga2V5IHVzZWQgdG8gam9pbiB0byB0aGUgcGFyZW50cy5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwgbnVtYmVyPn0gYXJncy5wYXJlbnRJZHMgLSBQcmltYXJ5IGtleXMgb2YgdGhlIGxvYWRlZCBwYXJlbnRzLlxuICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZyB8IG51bWJlciwgbnVtYmVyPj59IC0gTWFwIG9mIHBhcmVudCBwayDihpIgY291bnQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVDaHVua2VkQ291bnRRdWVyeSh7YmFzZVF1ZXJ5LCBmb3JlaWduS2V5LCBwYXJlbnRJZHN9KSB7XG4gIGNvbnN0IGRyaXZlciA9IGJhc2VRdWVyeS5kcml2ZXJcbiAgY29uc3QgY29ob3J0cyA9IGRyaXZlci5jaHVua1ZhbHVlcyhwYXJlbnRJZHMsIChjaHVuaykgPT4gYmFzZVF1ZXJ5LmNsb25lKCkud2hlcmUoe1tmb3JlaWduS2V5XTogY2h1bmt9KS50b1NxbCgpKVxuXG4gIC8qKlxuICAgKiBDb3VudHMuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nIHwgbnVtYmVyLCBudW1iZXI+fSAqL1xuICBjb25zdCBjb3VudHMgPSBuZXcgTWFwKClcblxuICBmb3IgKGNvbnN0IGNvaG9ydCBvZiBjb2hvcnRzKSB7XG4gICAgY29uc3QgY29ob3J0UXVlcnkgPSBiYXNlUXVlcnkuY2xvbmUoKS53aGVyZSh7W2ZvcmVpZ25LZXldOiBjb2hvcnR9KVxuICAgIGNvbnN0IGNvaG9ydENvdW50cyA9IGF3YWl0IGV4ZWN1dGVDb3VudFF1ZXJ5KGNvaG9ydFF1ZXJ5KVxuXG4gICAgZm9yIChjb25zdCBbcGFyZW50SWQsIGNvdW50XSBvZiBjb2hvcnRDb3VudHMpIHtcbiAgICAgIGNvdW50cy5zZXQocGFyZW50SWQsIGNvdW50KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjb3VudHNcbn1cblxuLyoqXG4gKiBBdHRhY2hlcyBvbmUgZW50cnkncyByZXNvbHZlZCBjb3VudHMgdG8gdGhlIGxvYWRlZCBtb2RlbHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcgfCBudW1iZXIsIG51bWJlcj59IGFyZ3MuY291bnRzIC0gQ291bnRzIGtleWVkIGJ5IHBhcmVudCBwcmltYXJ5IGtleS5cbiAqIEBwYXJhbSB7V2l0aENvdW50RW50cnl9IGFyZ3MuZW50cnkgLSBFbnRyeSB3aG9zZSBhbGlhcyByZWNlaXZlcyB0aGUgY291bnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLm1vZGVscyAtIExvYWRlZCBwYXJlbnQgcmVjb3Jkcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByaW1hcnlLZXkgLSBQYXJlbnQgcHJpbWFyeSBrZXkgY29sdW1uLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGF0dGFjaENvdW50cyh7Y291bnRzLCBlbnRyeSwgbW9kZWxzLCBwcmltYXJ5S2V5fSkge1xuICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleVZhbHVlID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuICAgIC8vIFRvbGVyYXRlIGRyaXZlciBkaWZmZXJlbmNlcyBpbiBudW1lcmljIHJldHVybiB0eXBlczogU1FMaXRlXG4gICAgLy8gcmV0dXJucyBpbnRlZ2VycyBhcyBKUyBudW1iZXJzLCBidXQgTXlTUUwncyByYXcgZHJpdmVyIGNhblxuICAgIC8vIHJldHVybiBjb3VudCBwcmltYXJ5IGtleXMgYXMgc3RyaW5ncy4gVHJ5IGJvdGguXG4gICAgY29uc3QgcmVzb2x2ZWRDb3VudCA9IGNvdW50cy5oYXMobW9kZWxQcmltYXJ5S2V5VmFsdWUpXG4gICAgICA/IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAoY291bnRzLmdldChtb2RlbFByaW1hcnlLZXlWYWx1ZSkpXG4gICAgICA6IE51bWJlcihjb3VudHMuZ2V0KFN0cmluZyhtb2RlbFByaW1hcnlLZXlWYWx1ZSkpID8/IDApXG5cbiAgICAvLyBDb3VudHMgZ28gb24gdGhlIHJlY29yZCdzIGRlZGljYXRlZCBhc3NvY2lhdGlvbi1jb3VudCBtYXAsXG4gICAgLy8gTk9UIG9uIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBgdGFza3NDb3VudGAgY2FuJ3Qgc2hhZG93IGFcbiAgICAvLyByZWFsIGB0YXNrc19jb3VudGAgY29sdW1uIChlLmcuIGEgY291bnRlcl9jYWNoZSkgbm9yIGxlYWsgaW50b1xuICAgIC8vIGF0dHJpYnV0ZS1sZXZlbCBzZXJpYWxpemF0aW9uIC8gY2hhbmdlIHRyYWNraW5nLlxuICAgIG1vZGVsLl9zZXRBc3NvY2lhdGlvbkNvdW50KGVudHJ5LmF0dHJpYnV0ZU5hbWUsIHJlc29sdmVkQ291bnQpXG4gIH1cbn1cbiJdfQ==