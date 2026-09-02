// @ts-check
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
    const primaryKey = modelClass.primaryKey();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2l0aC1jb3VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aXRoLWNvdW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsTUFBTSxVQUFVLGtCQUFrQixDQUFDLElBQUk7SUFDckMsSUFBSSxJQUFJLElBQUksSUFBSTtRQUFFLE9BQU8sRUFBRSxDQUFBO0lBRTNCLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDN0IsT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0lBQzlCLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN4QixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRTtZQUMzQixJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxPQUFPLElBQUksRUFBRSxDQUFDLENBQUE7WUFDaEYsQ0FBQztZQUVELE9BQU8sYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzVCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVELElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDN0I7O3NDQUU4QjtRQUM5QixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUE7UUFFbEIsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNoRCxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQztnQkFDbkIsT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFD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RUFBaUU7UUFDakUsaUVBQWlFO1FBQ2pFLG1EQUFtRDtRQUNuRCxLQUFLLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQTtJQUNoRSxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFdpdGhDb3VudEVudHJ5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXaXRoQ291bnRFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgdG8gc2V0IG9uIGVhY2ggcGFyZW50IHJlY29yZCBob2xkaW5nIHRoZSBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gSGFzLW1hbnkgcmVsYXRpb25zaGlwIHdob3NlIHJvd3MgYXJlIGNvdW50ZWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gd2hlcmUgLSBPcHRpb25hbCBleHRyYSB3aGVyZSBjbGF1c2UgYXBwbGllZCB0byB0aGUgY291bnQgcXVlcnkuXG4gKi9cblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSBXaXRoQ291bnRTcGVjXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemUgdGhlIGZsZXhpYmxlIHVzZXItZmFjaW5nIGAud2l0aENvdW50KC4uLilgIGFyZ3VtZW50IGludG8gdGhlXG4gKiBzdHJpY3QgaW50ZXJuYWwgbGlzdCBvZiB7YXR0cmlidXRlTmFtZSwgcmVsYXRpb25zaGlwTmFtZSwgd2hlcmV9IGVudHJpZXNcbiAqIHRoZSBydW5uZXIgY29uc3VtZXMuXG4gKlxuICogQWNjZXB0ZWQgc2hhcGVzOlxuICogICBcInByb2plY3RzXCIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBvbmUgZW50cnlcbiAqICAgW1wicHJvamVjdHNcIiwgXCJ0aW1lbG9nc1wiXSAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBvbmUgZW50cnkgcGVyIG5hbWVcbiAqICAge3Byb2plY3RzOiB0cnVlfSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaSIG9uZSBlbnRyeSAoYXR0ciA9IFwicHJvamVjdHNDb3VudFwiKVxuICogICB7YWN0aXZlTWVtYmVyc0NvdW50OiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDihpIgY3VzdG9tIGF0dHJpYnV0ZSBuYW1lXG4gKiAgICAge3JlbGF0aW9uc2hpcDogXCJ1c2Vyc1wiLCB3aGVyZToge2FjdGl2ZTogdHJ1ZX19fVxuICogQHBhcmFtIHtXaXRoQ291bnRTcGVjfSBzcGVjIC0gVXNlci1zdXBwbGllZCBzcGVjLlxuICogQHJldHVybnMge1dpdGhDb3VudEVudHJ5W119IC0gTm9ybWFsaXplZCBlbnRyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplV2l0aENvdW50KHNwZWMpIHtcbiAgaWYgKHNwZWMgPT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFtlbnRyeUZyb21OYW1lKHNwZWMpXVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc3BlYykpIHtcbiAgICByZXR1cm4gc3BlYy5mbGF0TWFwKChpdGVtKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGl0ZW0gIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoQ291bnQgYXJyYXkgZW50cmllcyBtdXN0IGJlIHN0cmluZ3M7IGdvdCAke3R5cGVvZiBpdGVtfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBlbnRyeUZyb21OYW1lKGl0ZW0pXG4gICAgfSlcbiAgfVxuXG4gIGlmICh0eXBlb2Ygc3BlYyA9PT0gXCJvYmplY3RcIikge1xuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge1dpdGhDb3VudEVudHJ5W119ICovXG4gICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzcGVjKSkge1xuICAgICAgaWYgKHZhbHVlID09PSB0cnVlKSB7XG4gICAgICAgIGVudHJpZXMucHVzaChlbnRyeUZyb21OYW1lKGtleSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICAvKipcbiAgICAgICAgICogT3B0aW9ucy5cbiAgICAgICAgICogQHR5cGUge3tyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi9cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHZhbHVlXG4gICAgICAgIGVudHJpZXMucHVzaCh7XG4gICAgICAgICAgYXR0cmlidXRlTmFtZToga2V5LFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWU6IG9wdGlvbnMucmVsYXRpb25zaGlwIHx8IGtleSxcbiAgICAgICAgICB3aGVyZTogb3B0aW9ucy53aGVyZVxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgd2l0aENvdW50IHZhbHVlIGZvciAke2tleX06ICR7dHlwZW9mIHZhbHVlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB3aXRoQ291bnQgc3BlYzogJHt0eXBlb2Ygc3BlY31gKVxufVxuXG4vKipcbiAqIFJ1bnMgZW50cnkgZnJvbSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSAoYXR0cmlidXRlIG5hbWUgaXMgZGVyaXZlZCBieSBhcHBlbmRpbmcgXCJDb3VudFwiKS5cbiAqIEByZXR1cm5zIHtXaXRoQ291bnRFbnRyeX0gLSBOb3JtYWxpemVkIGFzc29jaWF0aW9uLWNvdW50IGVudHJ5LlxuICovXG5mdW5jdGlvbiBlbnRyeUZyb21OYW1lKG5hbWUpIHtcbiAgcmV0dXJuIHtcbiAgICBhdHRyaWJ1dGVOYW1lOiBgJHtuYW1lfUNvdW50YCxcbiAgICByZWxhdGlvbnNoaXBOYW1lOiBuYW1lLFxuICAgIHdoZXJlOiB1bmRlZmluZWRcbiAgfVxufVxuXG4vKipcbiAqIFJ1biBldmVyeSB3aXRoQ291bnQgZW50cnkgYWdhaW5zdCB0aGUgbG9hZGVkIHBhcmVudCByZWNvcmRzLCBhdHRhY2hpbmdcbiAqIHRoZSByZXN1bHRpbmcgY291bnRzIGFzIGF0dHJpYnV0ZXMgb24gZWFjaCByZWNvcmQuIE1pcnJvcnMgdGhlXG4gKiBQcmVsb2FkZXIncyBkYXRhLWZsb3cgc2hhcGUg4oCUIG9uZSBncm91cGVkIGNvdW50IHF1ZXJ5IHBlciBlbnRyeSwgdGhlblxuICogYHNldEF0dHJpYnV0ZWAgb24gZWFjaCBwYXJlbnQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gTG9hZGVkIHBhcmVudCByZWNvcmRzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIFBhcmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7V2l0aENvdW50RW50cnlbXX0gYXJncy5lbnRyaWVzIC0gTm9ybWFsaXplZCB3aXRoQ291bnQgZW50cmllcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuV2l0aENvdW50KHttb2RlbHMsIG1vZGVsQ2xhc3MsIGVudHJpZXN9KSB7XG4gIGlmIChtb2RlbHMubGVuZ3RoID09PSAwIHx8IGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBjb25zdCBwcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgY29uc3QgcGFyZW50SWRzID0gbW9kZWxzLm1hcCgobW9kZWwpID0+IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAobW9kZWwucmVhZENvbHVtbihwcmltYXJ5S2V5KSkpXG4gIGNvbnN0IHNvdXJjZU1vZGVsID0gbW9kZWxzWzBdXG4gIGNvbnN0IHF1ZXJ5R3JvdXBzID0gbmV3IE1hcCgpXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgY29uc3Qge2Jhc2VRdWVyeSwgZm9yZWlnbktleX0gPSBxdWVyeUZvckVudHJ5KHtlbnRyeSwgbW9kZWxDbGFzcywgc291cmNlTW9kZWx9KVxuICAgIGNvbnN0IHNxbCA9IGJhc2VRdWVyeS50b1NxbCgpXG4gICAgY29uc3QgZXhpc3RpbmdHcm91cCA9IHF1ZXJ5R3JvdXBzLmdldChzcWwpXG5cbiAgICBpZiAoZXhpc3RpbmdHcm91cCkge1xuICAgICAgZXhpc3RpbmdHcm91cC5lbnRyaWVzLnB1c2goZW50cnkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5R3JvdXBzLnNldChzcWwsIHtiYXNlUXVlcnksIGVudHJpZXM6IFtlbnRyeV0sIGZvcmVpZ25LZXl9KVxuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3Qge2Jhc2VRdWVyeSwgZW50cmllczogZ3JvdXBlZEVudHJpZXMsIGZvcmVpZ25LZXl9IG9mIHF1ZXJ5R3JvdXBzLnZhbHVlcygpKSB7XG4gICAgY29uc3QgY291bnRzID0gYXdhaXQgZXhlY3V0ZUNodW5rZWRDb3VudFF1ZXJ5KHtiYXNlUXVlcnksIGZvcmVpZ25LZXksIHBhcmVudElkc30pXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGdyb3VwZWRFbnRyaWVzKSBhdHRhY2hDb3VudHMoe2NvdW50cywgZW50cnksIG1vZGVscywgcHJpbWFyeUtleX0pXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIGdyb3VwZWQgY291bnQgcXVlcnkgZm9yIGFuIGVudHJ5LlxuICpcbiAqIFRoZSByZXR1cm5lZCBxdWVyeSBkb2VzIE5PVCB5ZXQgZmlsdGVyIGJ5IHBhcmVudCBJRHM7IGNhbGxlcnMgY2h1bmsgdGhlXG4gKiBwYXJlbnQgY29ob3J0IGFuZCBhcHBseSB0aGUgZm9yZWlnbi1rZXkgSU4gY2xhdXNlIHBlciBjaHVuay5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7V2l0aENvdW50RW50cnl9IGFyZ3MuZW50cnkgLSBFbnRyeSBiZWluZyBldmFsdWF0ZWQuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5zb3VyY2VNb2RlbCAtIExvYWRlZCBvcGVyYXRpb24gb3duZXIuXG4gKiBAcmV0dXJucyB7e2Jhc2VRdWVyeTogaW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0LCBmb3JlaWduS2V5OiBzdHJpbmd9fSAtIFByZXBhcmVkIGNvdW50IHF1ZXJ5IGFuZCBpdHMgZm9yZWlnbiBrZXkuXG4gKi9cbmZ1bmN0aW9uIHF1ZXJ5Rm9yRW50cnkoe2VudHJ5LCBtb2RlbENsYXNzLCBzb3VyY2VNb2RlbH0pIHtcbiAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoZW50cnkucmVsYXRpb25zaGlwTmFtZSlcblxuICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHttb2RlbENsYXNzLm5hbWV9IGhhcyBubyByZWxhdGlvbnNoaXAgbmFtZWQgJHtKU09OLnN0cmluZ2lmeShlbnRyeS5yZWxhdGlvbnNoaXBOYW1lKX0gKHdpdGhDb3VudCBhdHRyaWJ1dGUgJHtKU09OLnN0cmluZ2lmeShlbnRyeS5hdHRyaWJ1dGVOYW1lKX0pYClcbiAgfVxuXG4gIGlmIChyZWxhdGlvbnNoaXAudHlwZSAhPT0gXCJoYXNNYW55XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhDb3VudCBjdXJyZW50bHkgc3VwcG9ydHMgb25seSBoYXNNYW55IHJlbGF0aW9uc2hpcHM7ICR7bW9kZWxDbGFzcy5uYW1lfSMke2VudHJ5LnJlbGF0aW9uc2hpcE5hbWV9IGlzICR7cmVsYXRpb25zaGlwLnR5cGV9YClcbiAgfVxuXG4gIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgaWYgKCFyYXdUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoQ291bnQ6IGNvdWxkIG5vdCByZXNvbHZlIHRhcmdldCBtb2RlbCBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7ZW50cnkucmVsYXRpb25zaGlwTmFtZX1gKVxuICB9XG5cbiAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXlGb3JNb2RlbENsYXNzZXMoe21vZGVsQ2xhc3MsIHRhcmdldE1vZGVsQ2xhc3N9KVxuICAvKipcbiAgICogTWFuZGF0b3J5IGNvaG9ydCBjb25kaXRpb25zLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBtYW5kYXRvcnlXaGVyZUNvbmRpdGlvbnMgPSB7fVxuXG4gIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMgJiYgcmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkpIHtcbiAgICBjb25zdCB0eXBlQ29sdW1uID0gcmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG4gICAgbWFuZGF0b3J5V2hlcmVDb25kaXRpb25zW3R5cGVDb2x1bW5dID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICB9XG5cbiAgY29uc3QgYmFzZVF1ZXJ5ID0gc291cmNlTW9kZWwucXVlcnlGb3JNb2RlbCh0YXJnZXRNb2RlbENsYXNzKVxuXG4gIGJhc2VRdWVyeS5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gdHJ1ZVxuXG4gIGlmIChPYmplY3Qua2V5cyhtYW5kYXRvcnlXaGVyZUNvbmRpdGlvbnMpLmxlbmd0aCA+IDApIHtcbiAgICBiYXNlUXVlcnkud2hlcmUobWFuZGF0b3J5V2hlcmVDb25kaXRpb25zKVxuICB9XG5cbiAgaWYgKGVudHJ5LndoZXJlKSB7XG4gICAgYmFzZVF1ZXJ5LndoZXJlKGVudHJ5LndoZXJlKVxuICB9XG5cbiAgY29uc3QgY291bnRRdWVyeSA9IHJlbGF0aW9uc2hpcC5hcHBseVNjb3BlKGJhc2VRdWVyeSlcblxuICBjb3VudFF1ZXJ5Ll9wcmVsb2FkID0ge31cbiAgY291bnRRdWVyeS5yZXNlbGVjdCgpXG5cbiAgY29uc3QgZHJpdmVyID0gY291bnRRdWVyeS5kcml2ZXJcbiAgY29uc3QgcXVvdGVkVGFibGUgPSBkcml2ZXIucXVvdGVUYWJsZShjb3VudFF1ZXJ5LnJvb3RUYWJsZVJlZmVyZW5jZSgpKVxuICBjb25zdCBxdW90ZWRGayA9IGRyaXZlci5xdW90ZUNvbHVtbihmb3JlaWduS2V5KVxuICBjb25zdCBxdWFsaWZpZWRGb3JlaWduS2V5ID0gYCR7cXVvdGVkVGFibGV9LiR7cXVvdGVkRmt9YFxuXG4gIGNvdW50UXVlcnkuZ3JvdXAocXVhbGlmaWVkRm9yZWlnbktleSlcbiAgY291bnRRdWVyeS5zZWxlY3QoYCR7cXVhbGlmaWVkRm9yZWlnbktleX0gQVMgcGFyZW50X2lkYClcbiAgY291bnRRdWVyeS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudF92YWx1ZVwiKVxuXG4gIHJldHVybiB7YmFzZVF1ZXJ5OiBjb3VudFF1ZXJ5LCBmb3JlaWduS2V5fVxufVxuXG4vKipcbiAqIEV4ZWN1dGVzIGEgcHJlcGFyZWQgZ3JvdXBlZCBjb3VudCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBjb3VudFF1ZXJ5IC0gUHJlcGFyZWQgY291bnQgcXVlcnkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nIHwgbnVtYmVyLCBudW1iZXI+Pn0gLSBNYXAgb2YgcGFyZW50IHBrIOKGkiBjb3VudC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZUNvdW50UXVlcnkoY291bnRRdWVyeSkge1xuICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7cGFyZW50X2lkOiBzdHJpbmcgfCBudW1iZXIsIGNvdW50X3ZhbHVlOiBzdHJpbmcgfCBudW1iZXJ9Pn0gKi8gKFxuICAgIGF3YWl0IGNvdW50UXVlcnkuX2V4ZWN1dGVRdWVyeSgpXG4gIClcblxuICAvKipcbiAgICogQ291bnRzLlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZyB8IG51bWJlciwgbnVtYmVyPn0gKi9cbiAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpXG5cbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IHBhcmVudElkID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChyb3cucGFyZW50X2lkKVxuICAgIGNvbnN0IGNvdW50VmFsdWUgPSBOdW1iZXIocm93LmNvdW50X3ZhbHVlKSB8fCAwXG4gICAgY291bnRzLnNldChwYXJlbnRJZCwgY291bnRWYWx1ZSlcbiAgfVxuXG4gIHJldHVybiBjb3VudHNcbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIGdyb3VwZWQgY291bnQgcXVlcnkgaW4gY29ob3J0cyBzbyB0aGUgcGFyZW50IElEIElOLWxpc3Qgc3RheXNcbiAqIHdpdGhpbiBkcml2ZXIgbGltaXRzLCBtZXJnaW5nIHBlci1wYXJlbnQgY291bnRzIGFjcm9zcyBjaHVua3MuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5iYXNlUXVlcnkgLSBQcmVwYXJlZCBjb3VudCBxdWVyeSB3aXRob3V0IHBhcmVudCBJRHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mb3JlaWduS2V5IC0gRm9yZWlnbiBrZXkgdXNlZCB0byBqb2luIHRvIHRoZSBwYXJlbnRzLlxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnBhcmVudElkcyAtIFByaW1hcnkga2V5cyBvZiB0aGUgbG9hZGVkIHBhcmVudHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nIHwgbnVtYmVyLCBudW1iZXI+Pn0gLSBNYXAgb2YgcGFyZW50IHBrIOKGkiBjb3VudC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZUNodW5rZWRDb3VudFF1ZXJ5KHtiYXNlUXVlcnksIGZvcmVpZ25LZXksIHBhcmVudElkc30pIHtcbiAgY29uc3QgZHJpdmVyID0gYmFzZVF1ZXJ5LmRyaXZlclxuICBjb25zdCBjb2hvcnRzID0gZHJpdmVyLmNodW5rVmFsdWVzKHBhcmVudElkcywgKGNodW5rKSA9PiBiYXNlUXVlcnkuY2xvbmUoKS53aGVyZSh7W2ZvcmVpZ25LZXldOiBjaHVua30pLnRvU3FsKCkpXG5cbiAgLyoqXG4gICAqIENvdW50cy5cbiAgICogQHR5cGUge01hcDxzdHJpbmcgfCBudW1iZXIsIG51bWJlcj59ICovXG4gIGNvbnN0IGNvdW50cyA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3QgY29ob3J0IG9mIGNvaG9ydHMpIHtcbiAgICBjb25zdCBjb2hvcnRRdWVyeSA9IGJhc2VRdWVyeS5jbG9uZSgpLndoZXJlKHtbZm9yZWlnbktleV06IGNvaG9ydH0pXG4gICAgY29uc3QgY29ob3J0Q291bnRzID0gYXdhaXQgZXhlY3V0ZUNvdW50UXVlcnkoY29ob3J0UXVlcnkpXG5cbiAgICBmb3IgKGNvbnN0IFtwYXJlbnRJZCwgY291bnRdIG9mIGNvaG9ydENvdW50cykge1xuICAgICAgY291bnRzLnNldChwYXJlbnRJZCwgY291bnQpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvdW50c1xufVxuXG4vKipcbiAqIEF0dGFjaGVzIG9uZSBlbnRyeSdzIHJlc29sdmVkIGNvdW50cyB0byB0aGUgbG9hZGVkIG1vZGVscy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7TWFwPHN0cmluZyB8IG51bWJlciwgbnVtYmVyPn0gYXJncy5jb3VudHMgLSBDb3VudHMga2V5ZWQgYnkgcGFyZW50IHByaW1hcnkga2V5LlxuICogQHBhcmFtIHtXaXRoQ291bnRFbnRyeX0gYXJncy5lbnRyeSAtIEVudHJ5IHdob3NlIGFsaWFzIHJlY2VpdmVzIHRoZSBjb3VudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gTG9hZGVkIHBhcmVudCByZWNvcmRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJpbWFyeUtleSAtIFBhcmVudCBwcmltYXJ5IGtleSBjb2x1bW4uXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXR0YWNoQ291bnRzKHtjb3VudHMsIGVudHJ5LCBtb2RlbHMsIHByaW1hcnlLZXl9KSB7XG4gIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgY29uc3QgbW9kZWxQcmltYXJ5S2V5VmFsdWUgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpXG4gICAgLy8gVG9sZXJhdGUgZHJpdmVyIGRpZmZlcmVuY2VzIGluIG51bWVyaWMgcmV0dXJuIHR5cGVzOiBTUUxpdGVcbiAgICAvLyByZXR1cm5zIGludGVnZXJzIGFzIEpTIG51bWJlcnMsIGJ1dCBNeVNRTCdzIHJhdyBkcml2ZXIgY2FuXG4gICAgLy8gcmV0dXJuIGNvdW50IHByaW1hcnkga2V5cyBhcyBzdHJpbmdzLiBUcnkgYm90aC5cbiAgICBjb25zdCByZXNvbHZlZENvdW50ID0gY291bnRzLmhhcyhtb2RlbFByaW1hcnlLZXlWYWx1ZSlcbiAgICAgID8gLyoqIEB0eXBlIHtudW1iZXJ9ICovIChjb3VudHMuZ2V0KG1vZGVsUHJpbWFyeUtleVZhbHVlKSlcbiAgICAgIDogTnVtYmVyKGNvdW50cy5nZXQoU3RyaW5nKG1vZGVsUHJpbWFyeUtleVZhbHVlKSkgPz8gMClcblxuICAgIC8vIENvdW50cyBnbyBvbiB0aGUgcmVjb3JkJ3MgZGVkaWNhdGVkIGFzc29jaWF0aW9uLWNvdW50IG1hcCxcbiAgICAvLyBOT1Qgb24gYF9hdHRyaWJ1dGVzYCwgc28gYSB2aXJ0dWFsIGB0YXNrc0NvdW50YCBjYW4ndCBzaGFkb3cgYVxuICAgIC8vIHJlYWwgYHRhc2tzX2NvdW50YCBjb2x1bW4gKGUuZy4gYSBjb3VudGVyX2NhY2hlKSBub3IgbGVhayBpbnRvXG4gICAgLy8gYXR0cmlidXRlLWxldmVsIHNlcmlhbGl6YXRpb24gLyBjaGFuZ2UgdHJhY2tpbmcuXG4gICAgbW9kZWwuX3NldEFzc29jaWF0aW9uQ291bnQoZW50cnkuYXR0cmlidXRlTmFtZSwgcmVzb2x2ZWRDb3VudClcbiAgfVxufVxuIl19