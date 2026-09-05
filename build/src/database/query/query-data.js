// @ts-check
import { isPlainObject } from "is-plain-object";
import { scalarModelPrimaryKey } from "../../utils/model-primary-key.js";
/**
 * QueryDataEntry type.
 * @typedef {object} QueryDataEntry
 * @property {string[]} chain - Relationship chain from the root model to the model that declares the fn. Empty for a root-level entry.
 * @property {string} fnName - Identifier under which the fn is registered on the declaring model.
 */
/**
 * Defines this typedef.
 * @typedef {string | Array<string | Record<string, ReturnType<typeof JSON.parse>>> | {[key: string]: true | false | string | string[] | Record<string, ReturnType<typeof JSON.parse>>}} QueryDataSpec
 */
/**
 * QueryDataCallbackArgs type.
 * @typedef {object} QueryDataCallbackArgs
 * @property {string} attributeName - Name under which the fn was registered. Convenient when a fn is reused across aliases.
 * @property {import("../drivers/base.js").default} driver - Active database driver, for quoting helpers and type-specific SQL.
 * @property {typeof import("../record/index.js").default} modelClass - Model class the fn is registered on (the chain's target).
 * @property {Array<string | number>} parentIds - Primary-key values of the loaded root records.
 * @property {import("./model-class-query.js").default} query - Grouped query already joined down the chain, filtered by `parentIds`, with `parent_id` pre-selected.
 * @property {string} tableName - Unquoted table reference (alias or table name) for the chain's target, ready to paste into SQL.
 */
/**
 * QueryDataFn type.
 * @typedef {(args: QueryDataCallbackArgs) => void | import("./model-class-query.js").default} QueryDataFn
 */
/**
 * Normalize a user-supplied queryData spec into a flat list of entries
 * the runner can consume. The spec mirrors the shape of `preload`, with
 * the important distinction that **leaf strings are fn names**, not
 * further relationship segments. Nested keys are relationship names
 * along the join chain from the root model to the declaring model.
 *
 * Accepted shapes (all yield the same flat entries):
 *   "foo"                                      → [{chain: [], fnName: "foo"}]
 *   ["foo", "bar"]                             → [{chain: [], fnName: "foo"}, {chain: [], fnName: "bar"}]
 *   {foo: true}                                → [{chain: [], fnName: "foo"}]
 *   {projects: ["tasksCount"]}                 → [{chain: ["projects"], fnName: "tasksCount"}]
 *   {projects: {tasks: ["transportSecondsSum", {timelogs: ["timeSecondsSum"]}]}}
 *     → [{chain: ["projects","tasks"], fnName: "transportSecondsSum"},
 *        {chain: ["projects","tasks","timelogs"], fnName: "timeSecondsSum"}]
 * @param {QueryDataSpec} spec - User-supplied spec.
 * @param {string[]} [chain] - Current chain (internal recursion).
 * @returns {QueryDataEntry[]} - Flat list of entries.
 */
export function normalizeQueryDataSpec(spec, chain = []) {
    if (spec == null)
        return [];
    if (typeof spec === "string") {
        return [{ chain: [...chain], fnName: spec }];
    }
    if (Array.isArray(spec)) {
        /**
         * Entries.
         * @type {QueryDataEntry[]} */
        const entries = [];
        for (const item of spec) {
            if (typeof item === "string") {
                entries.push({ chain: [...chain], fnName: item });
                continue;
            }
            if (isPlainObject(item)) {
                for (const nested of normalizeQueryDataSpec(/** @type {ReturnType<typeof JSON.parse>} */ (item), chain)) {
                    entries.push(nested);
                }
                continue;
            }
            throw new Error(`Invalid queryData array entry: ${typeof item}`);
        }
        return entries;
    }
    if (isPlainObject(spec)) {
        /**
         * Entries.
         * @type {QueryDataEntry[]} */
        const entries = [];
        for (const [key, value] of Object.entries(spec)) {
            if (value === true) {
                entries.push({ chain: [...chain], fnName: key });
                continue;
            }
            if (value === false)
                continue;
            if (typeof value === "string" || Array.isArray(value) || isPlainObject(value)) {
                for (const nested of normalizeQueryDataSpec(/** @type {ReturnType<typeof JSON.parse>} */ (value), [...chain, key])) {
                    entries.push(nested);
                }
                continue;
            }
            throw new Error(`Invalid queryData value for "${key}": ${typeof value}`);
        }
        return entries;
    }
    throw new Error(`Invalid queryData spec: ${typeof spec}`);
}
/**
 * Build the nested `joins(...)` descriptor for a chain of relationship names.
 * `["projects", "tasks"]` → `{projects: {tasks: true}}`. Used internally so
 * the runner can reuse the existing `joins` path-registration machinery
 * (JoinTracker, alias generation, scope application).
 * @param {string[]} chain - Relationship chain.
 * @returns {true | Record<string, ReturnType<typeof JSON.parse>>} - Nested join descriptor, or `true` when the chain is empty.
 */
function buildNestedJoinDescriptor(chain) {
    if (chain.length === 0)
        return true;
    /**
     * Obj.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const obj = {};
    let cursor = obj;
    for (let i = 0; i < chain.length; i += 1) {
        const seg = chain[i];
        const isLast = i === chain.length - 1;
        cursor[seg] = isLast ? true : {};
        if (!isLast)
            cursor = cursor[seg];
    }
    return obj;
}
/**
 * Walk a relationship chain from the root model and return the model
 * class at its tail. Throws with a clear message when any segment is
 * unknown.
 * @param {typeof import("../record/index.js").default} rootModelClass - Root model class.
 * @param {string[]} chain - Relationship chain.
 * @returns {typeof import("../record/index.js").default} - Target model class.
 */
function resolveTargetModelClass(rootModelClass, chain) {
    let modelClass = rootModelClass;
    for (const segment of chain) {
        const relationship = modelClass.getRelationshipByName(segment);
        const rawTarget = relationship.getTargetModelClass();
        if (!rawTarget) {
            throw new Error(`queryData: could not resolve target model for ${modelClass.name}#${segment}`);
        }
        modelClass = modelClass.bindRecordMetadataModelClass(rawTarget);
    }
    return modelClass;
}
/**
 * Run every queryData entry against the loaded root records, attaching
 * the resulting values as queryData entries on each root record.
 *
 * One grouped query per entry: the runner builds a fresh query over the
 * root model, joins down the chain, groups by the root table's primary
 * key, and invokes the registered fn to add its own SELECT (and any
 * additional joins/where). Results are mapped back to root models by
 * primary key and attached via `_setQueryData(name, value)` for every
 * selected alias (except the reserved `parent_id`). Rows missing from
 * the result keep `null` — matches the feature's documented default.
 *
 * Mirrors the shape of `runWithCount`: one query per entry, a separate
 * storage map on the record, never touches `_attributes`.
 * @param {object} args - Options.
 * @param {typeof import("../record/index.js").default} args.rootModelClass - Root model class.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @param {QueryDataEntry[]} args.entries - Normalized queryData entries.
 * @returns {Promise<void>}
 */
export async function runQueryData({ rootModelClass, rootModels, entries }) {
    if (rootModels.length === 0 || entries.length === 0)
        return;
    const primaryKey = scalarModelPrimaryKey(rootModelClass.primaryKey(), `queryData for ${rootModelClass.name}`);
    const rootIds = rootModels.map((model) => /** @type {string | number} */ (model.readColumn(primaryKey)));
    const sourceModel = rootModels[0];
    const preparedEntries = entries.map((entry, entryIndex) => prepareEntry({
        entry,
        entryIndex,
        primaryKey,
        rootIds,
        rootModelClass,
        sourceModel
    }));
    /**
     * Compatible query groups.
     * @type {Array<{aliases: Set<string>, query: import("./model-class-query.js").default, signature: string}>} */
    const queryGroups = [];
    for (const preparedEntry of preparedEntries) {
        const compatibleGroup = queryGroups.find((group, groupIndex) => {
            if (group.signature !== preparedEntry.signature)
                return false;
            if (queryGroups.slice(groupIndex + 1).some((interveningGroup) => (preparedEntry.aliases.some((alias) => interveningGroup.aliases.has(alias)))))
                return false;
            return preparedEntry.aliases.every((alias) => !group.aliases.has(alias));
        });
        if (compatibleGroup) {
            compatibleGroup.query.select(preparedEntry.query.getSelects().slice(1));
            for (const alias of preparedEntry.aliases)
                compatibleGroup.aliases.add(alias);
        }
        else {
            queryGroups.push({
                aliases: new Set(preparedEntry.aliases),
                query: preparedEntry.query,
                signature: preparedEntry.signature
            });
        }
    }
    for (const { query } of queryGroups) {
        await executeChunkedEntryQuery({ primaryKey, query, rootIds, rootModels });
    }
}
/**
 * Prepares one queryData entry and its compatibility metadata.
 * @param {object} args - Options.
 * @param {QueryDataEntry} args.entry - Entry being evaluated.
 * @param {number} args.entryIndex - Stable position used to isolate opaque projections.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {Array<string | number>} args.rootIds - Root primary-key values.
 * @param {typeof import("../record/index.js").default} args.rootModelClass - Root model class.
 * @param {import("../record/index.js").default} args.sourceModel - Loaded operation owner.
 * @returns {{aliases: string[], query: import("./model-class-query.js").default, signature: string}} - Prepared entry.
 */
function prepareEntry({ entry, entryIndex, primaryKey, rootIds, rootModelClass, sourceModel }) {
    const targetModelClass = resolveTargetModelClass(rootModelClass, entry.chain);
    const fn = targetModelClass.getQueryDataByName(entry.fnName);
    if (!fn) {
        throw new Error(`queryData: ${targetModelClass.name} has no entry registered as ${JSON.stringify(entry.fnName)}. ` +
            `Declare it with ${targetModelClass.name}.queryData(${JSON.stringify(entry.fnName)}, ({query, tableName}) => query.select(...))`);
    }
    const query = sourceModel.queryForModel(rootModelClass);
    // Empty out any defaults the query factory added — queryData runs
    // a bare aggregate, not a full model load.
    query.reselect();
    query._preload = {};
    // Force the root WHERE to qualify by table name so it survives the
    // joins the fn may add later (otherwise a child table sharing the
    // root PK column name, e.g. `id`, makes the clause ambiguous).
    query._forceQualifyBaseTable = true;
    const driver = query.driver;
    const rootTable = rootModelClass.tableName();
    const rootPkSql = `${driver.quoteTable(rootTable)}.${driver.quoteColumn(primaryKey)}`;
    const joinDescriptor = buildNestedJoinDescriptor(entry.chain);
    if (joinDescriptor !== true) {
        query.joins(joinDescriptor);
    }
    query.group(rootPkSql);
    query.select(`${rootPkSql} AS parent_id`);
    const targetTableRef = entry.chain.length === 0
        ? rootTable
        : query.getTableReferenceForJoin(...entry.chain);
    // NB: we intentionally leave `_joinBasePath` at [] so the outer chain
    // joins continue to resolve from the root model at render time. The
    // fn gets `tableName` for self-reference; additional joins from
    // nested levels should use full paths from the root.
    fn({
        attributeName: entry.fnName,
        driver,
        modelClass: targetModelClass,
        parentIds: rootIds,
        query,
        tableName: targetTableRef
    });
    const aliases = selectedAliases(query);
    const signatureQuery = query.clone();
    signatureQuery.reselect(signatureQuery.getSelects().slice(0, 1));
    return {
        aliases: aliases || [],
        query,
        signature: aliases ? signatureQuery.toSql() : `opaque:${entryIndex}`
    };
}
/**
 * Returns explicit aliases selected after the reserved parent id.
 * Entries with an opaque select stay isolated by receiving a unique compatibility alias.
 * @param {import("./model-class-query.js").default} query - Prepared queryData query.
 * @returns {string[] | null} - Selected aliases, or null for an opaque projection.
 */
function selectedAliases(query) {
    const aliases = [];
    for (const select of query.getSelects().slice(1)) {
        const alias = select.getAlias();
        if (!alias)
            return null;
        aliases.push(alias);
    }
    return aliases;
}
/**
 * Executes one compatible queryData group and attaches every selected alias.
 * @param {object} args - Options.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {import("./model-class-query.js").default} args.query - Prepared grouped query.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @returns {Promise<void>}
 */
async function executeEntryQuery({ primaryKey, query, rootModels }) {
    const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await query._executeQuery());
    const byParent = new Map();
    for (const row of rows) {
        const parentId = row.parent_id;
        if (parentId == null)
            continue;
        byParent.set(parentId, row);
    }
    for (const model of rootModels) {
        const modelId = /** @type {string | number} */ (model.readColumn(primaryKey));
        // Driver-type tolerance: MySQL can return PKs as strings even when
        // the column is numeric. Fall back to a string lookup so results
        // still land on the right model.
        const row = byParent.has(modelId)
            ? byParent.get(modelId)
            : byParent.get(String(modelId));
        if (!row)
            continue;
        for (const [columnName, value] of Object.entries(row)) {
            if (columnName === "parent_id")
                continue;
            model._setQueryData(columnName, value);
        }
    }
}
/**
 * Executes one compatible queryData group in cohorts so the root ID IN-list
 * stays within driver limits, attaching each selected alias to the matching
 * root record.
 * @param {object} args - Options.
 * @param {string} args.primaryKey - Root model primary key column.
 * @param {import("./model-class-query.js").default} args.query - Prepared grouped query.
 * @param {Array<string | number>} args.rootIds - Root primary-key values.
 * @param {import("../record/index.js").default[]} args.rootModels - Loaded root records.
 * @returns {Promise<void>}
 */
async function executeChunkedEntryQuery({ primaryKey, query, rootIds, rootModels }) {
    const driver = query.driver;
    const cohorts = driver.chunkValues(rootIds, (chunk) => query.clone().where({ [primaryKey]: chunk }).toSql());
    for (const cohort of cohorts) {
        const cohortQuery = query.clone().where({ [primaryKey]: cohort });
        await executeEntryQuery({ primaryKey, query: cohortQuery, rootModels });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktZGF0YS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9xdWVyeS1kYXRhLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDN0MsT0FBTyxFQUFDLHFCQUFxQixFQUFDLE1BQU0sa0NBQWtDLENBQUE7QUFFdEU7Ozs7O0dBS0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7O0dBU0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsTUFBTSxVQUFVLHNCQUFzQixDQUFDLElBQUksRUFBRSxLQUFLLEdBQUcsRUFBRTtJQUNyRCxJQUFJLElBQUksSUFBSSxJQUFJO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFM0IsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM3QixPQUFPLENBQUMsRUFBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQzVDLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN4Qjs7c0NBRThCO1FBQzlCLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVsQixLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3hCLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzdCLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUMvQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLEtBQUss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QUssRUFBRSxDQUFDLENBQUE7SUFFMUcsS0FBSyxNQUFNLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUM3QixNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRS9ELE1BQU0saUJBQWlCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7aXNQbGFpbk9iamVjdH0gZnJvbSBcImlzLXBsYWluLW9iamVjdFwiXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqXG4gKiBRdWVyeURhdGFFbnRyeSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUXVlcnlEYXRhRW50cnlcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNoYWluIC0gUmVsYXRpb25zaGlwIGNoYWluIGZyb20gdGhlIHJvb3QgbW9kZWwgdG8gdGhlIG1vZGVsIHRoYXQgZGVjbGFyZXMgdGhlIGZuLiBFbXB0eSBmb3IgYSByb290LWxldmVsIGVudHJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZuTmFtZSAtIElkZW50aWZpZXIgdW5kZXIgd2hpY2ggdGhlIGZuIGlzIHJlZ2lzdGVyZWQgb24gdGhlIGRlY2xhcmluZyBtb2RlbC5cbiAqL1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCB7W2tleTogc3RyaW5nXTogdHJ1ZSB8IGZhbHNlIHwgc3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBRdWVyeURhdGFTcGVjXG4gKi9cblxuLyoqXG4gKiBRdWVyeURhdGFDYWxsYmFja0FyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5RGF0YUNhbGxiYWNrQXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBOYW1lIHVuZGVyIHdoaWNoIHRoZSBmbiB3YXMgcmVnaXN0ZXJlZC4gQ29udmVuaWVudCB3aGVuIGEgZm4gaXMgcmV1c2VkIGFjcm9zcyBhbGlhc2VzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZHJpdmVyIC0gQWN0aXZlIGRhdGFiYXNlIGRyaXZlciwgZm9yIHF1b3RpbmcgaGVscGVycyBhbmQgdHlwZS1zcGVjaWZpYyBTUUwuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRoZSBmbiBpcyByZWdpc3RlcmVkIG9uICh0aGUgY2hhaW4ncyB0YXJnZXQpLlxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmcgfCBudW1iZXI+fSBwYXJlbnRJZHMgLSBQcmltYXJ5LWtleSB2YWx1ZXMgb2YgdGhlIGxvYWRlZCByb290IHJlY29yZHMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gcXVlcnkgLSBHcm91cGVkIHF1ZXJ5IGFscmVhZHkgam9pbmVkIGRvd24gdGhlIGNoYWluLCBmaWx0ZXJlZCBieSBgcGFyZW50SWRzYCwgd2l0aCBgcGFyZW50X2lkYCBwcmUtc2VsZWN0ZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVW5xdW90ZWQgdGFibGUgcmVmZXJlbmNlIChhbGlhcyBvciB0YWJsZSBuYW1lKSBmb3IgdGhlIGNoYWluJ3MgdGFyZ2V0LCByZWFkeSB0byBwYXN0ZSBpbnRvIFNRTC5cbiAqL1xuXG4vKipcbiAqIFF1ZXJ5RGF0YUZuIHR5cGUuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IFF1ZXJ5RGF0YUNhbGxiYWNrQXJncykgPT4gdm9pZCB8IGltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gUXVlcnlEYXRhRm5cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZSBhIHVzZXItc3VwcGxpZWQgcXVlcnlEYXRhIHNwZWMgaW50byBhIGZsYXQgbGlzdCBvZiBlbnRyaWVzXG4gKiB0aGUgcnVubmVyIGNhbiBjb25zdW1lLiBUaGUgc3BlYyBtaXJyb3JzIHRoZSBzaGFwZSBvZiBgcHJlbG9hZGAsIHdpdGhcbiAqIHRoZSBpbXBvcnRhbnQgZGlzdGluY3Rpb24gdGhhdCAqKmxlYWYgc3RyaW5ncyBhcmUgZm4gbmFtZXMqKiwgbm90XG4gKiBmdXJ0aGVyIHJlbGF0aW9uc2hpcCBzZWdtZW50cy4gTmVzdGVkIGtleXMgYXJlIHJlbGF0aW9uc2hpcCBuYW1lc1xuICogYWxvbmcgdGhlIGpvaW4gY2hhaW4gZnJvbSB0aGUgcm9vdCBtb2RlbCB0byB0aGUgZGVjbGFyaW5nIG1vZGVsLlxuICpcbiAqIEFjY2VwdGVkIHNoYXBlcyAoYWxsIHlpZWxkIHRoZSBzYW1lIGZsYXQgZW50cmllcyk6XG4gKiAgIFwiZm9vXCIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBbe2NoYWluOiBbXSwgZm5OYW1lOiBcImZvb1wifV1cbiAqICAgW1wiZm9vXCIsIFwiYmFyXCJdICAgICAgICAgICAgICAgICAgICAgICAgICAgICDihpIgW3tjaGFpbjogW10sIGZuTmFtZTogXCJmb29cIn0sIHtjaGFpbjogW10sIGZuTmFtZTogXCJiYXJcIn1dXG4gKiAgIHtmb286IHRydWV9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDihpIgW3tjaGFpbjogW10sIGZuTmFtZTogXCJmb29cIn1dXG4gKiAgIHtwcm9qZWN0czogW1widGFza3NDb3VudFwiXX0gICAgICAgICAgICAgICAgIOKGkiBbe2NoYWluOiBbXCJwcm9qZWN0c1wiXSwgZm5OYW1lOiBcInRhc2tzQ291bnRcIn1dXG4gKiAgIHtwcm9qZWN0czoge3Rhc2tzOiBbXCJ0cmFuc3BvcnRTZWNvbmRzU3VtXCIsIHt0aW1lbG9nczogW1widGltZVNlY29uZHNTdW1cIl19XX19XG4gKiAgICAg4oaSIFt7Y2hhaW46IFtcInByb2plY3RzXCIsXCJ0YXNrc1wiXSwgZm5OYW1lOiBcInRyYW5zcG9ydFNlY29uZHNTdW1cIn0sXG4gKiAgICAgICAge2NoYWluOiBbXCJwcm9qZWN0c1wiLFwidGFza3NcIixcInRpbWVsb2dzXCJdLCBmbk5hbWU6IFwidGltZVNlY29uZHNTdW1cIn1dXG4gKiBAcGFyYW0ge1F1ZXJ5RGF0YVNwZWN9IHNwZWMgLSBVc2VyLXN1cHBsaWVkIHNwZWMuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbY2hhaW5dIC0gQ3VycmVudCBjaGFpbiAoaW50ZXJuYWwgcmVjdXJzaW9uKS5cbiAqIEByZXR1cm5zIHtRdWVyeURhdGFFbnRyeVtdfSAtIEZsYXQgbGlzdCBvZiBlbnRyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUXVlcnlEYXRhU3BlYyhzcGVjLCBjaGFpbiA9IFtdKSB7XG4gIGlmIChzcGVjID09IG51bGwpIHJldHVybiBbXVxuXG4gIGlmICh0eXBlb2Ygc3BlYyA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiBbe2NoYWluOiBbLi4uY2hhaW5dLCBmbk5hbWU6IHNwZWN9XVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc3BlYykpIHtcbiAgICAvKipcbiAgICAgKiBFbnRyaWVzLlxuICAgICAqIEB0eXBlIHtRdWVyeURhdGFFbnRyeVtdfSAqL1xuICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIHNwZWMpIHtcbiAgICAgIGlmICh0eXBlb2YgaXRlbSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBlbnRyaWVzLnB1c2goe2NoYWluOiBbLi4uY2hhaW5dLCBmbk5hbWU6IGl0ZW19KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChpdGVtKSkge1xuICAgICAgICBmb3IgKGNvbnN0IG5lc3RlZCBvZiBub3JtYWxpemVRdWVyeURhdGFTcGVjKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpdGVtKSwgY2hhaW4pKSB7XG4gICAgICAgICAgZW50cmllcy5wdXNoKG5lc3RlZClcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIGFycmF5IGVudHJ5OiAke3R5cGVvZiBpdGVtfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNcbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KHNwZWMpKSB7XG4gICAgLyoqXG4gICAgICogRW50cmllcy5cbiAgICAgKiBAdHlwZSB7UXVlcnlEYXRhRW50cnlbXX0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMpKSB7XG4gICAgICBpZiAodmFsdWUgPT09IHRydWUpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKHtjaGFpbjogWy4uLmNoYWluXSwgZm5OYW1lOiBrZXl9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAodmFsdWUgPT09IGZhbHNlKSBjb250aW51ZVxuXG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpIHx8IGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICAgIGZvciAoY29uc3QgbmVzdGVkIG9mIG5vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKSwgWy4uLmNoYWluLCBrZXldKSkge1xuICAgICAgICAgIGVudHJpZXMucHVzaChuZXN0ZWQpXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHF1ZXJ5RGF0YSB2YWx1ZSBmb3IgXCIke2tleX1cIjogJHt0eXBlb2YgdmFsdWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHF1ZXJ5RGF0YSBzcGVjOiAke3R5cGVvZiBzcGVjfWApXG59XG5cbi8qKlxuICogQnVpbGQgdGhlIG5lc3RlZCBgam9pbnMoLi4uKWAgZGVzY3JpcHRvciBmb3IgYSBjaGFpbiBvZiByZWxhdGlvbnNoaXAgbmFtZXMuXG4gKiBgW1wicHJvamVjdHNcIiwgXCJ0YXNrc1wiXWAg4oaSIGB7cHJvamVjdHM6IHt0YXNrczogdHJ1ZX19YC4gVXNlZCBpbnRlcm5hbGx5IHNvXG4gKiB0aGUgcnVubmVyIGNhbiByZXVzZSB0aGUgZXhpc3RpbmcgYGpvaW5zYCBwYXRoLXJlZ2lzdHJhdGlvbiBtYWNoaW5lcnlcbiAqIChKb2luVHJhY2tlciwgYWxpYXMgZ2VuZXJhdGlvbiwgc2NvcGUgYXBwbGljYXRpb24pLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gY2hhaW4gLSBSZWxhdGlvbnNoaXAgY2hhaW4uXG4gKiBAcmV0dXJucyB7dHJ1ZSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgam9pbiBkZXNjcmlwdG9yLCBvciBgdHJ1ZWAgd2hlbiB0aGUgY2hhaW4gaXMgZW1wdHkuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTmVzdGVkSm9pbkRlc2NyaXB0b3IoY2hhaW4pIHtcbiAgaWYgKGNoYWluLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWVcblxuICAvKipcbiAgICogT2JqLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBvYmogPSB7fVxuICBsZXQgY3Vyc29yID0gb2JqXG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFpbi5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IHNlZyA9IGNoYWluW2ldXG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gY2hhaW4ubGVuZ3RoIC0gMVxuXG4gICAgY3Vyc29yW3NlZ10gPSBpc0xhc3QgPyB0cnVlIDoge31cblxuICAgIGlmICghaXNMYXN0KSBjdXJzb3IgPSBjdXJzb3Jbc2VnXVxuICB9XG5cbiAgcmV0dXJuIG9ialxufVxuXG4vKipcbiAqIFdhbGsgYSByZWxhdGlvbnNoaXAgY2hhaW4gZnJvbSB0aGUgcm9vdCBtb2RlbCBhbmQgcmV0dXJuIHRoZSBtb2RlbFxuICogY2xhc3MgYXQgaXRzIHRhaWwuIFRocm93cyB3aXRoIGEgY2xlYXIgbWVzc2FnZSB3aGVuIGFueSBzZWdtZW50IGlzXG4gKiB1bmtub3duLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJvb3RNb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IGNoYWluIC0gUmVsYXRpb25zaGlwIGNoYWluLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVUYXJnZXRNb2RlbENsYXNzKHJvb3RNb2RlbENsYXNzLCBjaGFpbikge1xuICBsZXQgbW9kZWxDbGFzcyA9IHJvb3RNb2RlbENsYXNzXG5cbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIGNoYWluKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoc2VnbWVudClcbiAgICBjb25zdCByYXdUYXJnZXQgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJhd1RhcmdldCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeURhdGE6IGNvdWxkIG5vdCByZXNvbHZlIHRhcmdldCBtb2RlbCBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7c2VnbWVudH1gKVxuICAgIH1cblxuICAgIG1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MocmF3VGFyZ2V0KVxuICB9XG5cbiAgcmV0dXJuIG1vZGVsQ2xhc3Ncbn1cblxuLyoqXG4gKiBSdW4gZXZlcnkgcXVlcnlEYXRhIGVudHJ5IGFnYWluc3QgdGhlIGxvYWRlZCByb290IHJlY29yZHMsIGF0dGFjaGluZ1xuICogdGhlIHJlc3VsdGluZyB2YWx1ZXMgYXMgcXVlcnlEYXRhIGVudHJpZXMgb24gZWFjaCByb290IHJlY29yZC5cbiAqXG4gKiBPbmUgZ3JvdXBlZCBxdWVyeSBwZXIgZW50cnk6IHRoZSBydW5uZXIgYnVpbGRzIGEgZnJlc2ggcXVlcnkgb3ZlciB0aGVcbiAqIHJvb3QgbW9kZWwsIGpvaW5zIGRvd24gdGhlIGNoYWluLCBncm91cHMgYnkgdGhlIHJvb3QgdGFibGUncyBwcmltYXJ5XG4gKiBrZXksIGFuZCBpbnZva2VzIHRoZSByZWdpc3RlcmVkIGZuIHRvIGFkZCBpdHMgb3duIFNFTEVDVCAoYW5kIGFueVxuICogYWRkaXRpb25hbCBqb2lucy93aGVyZSkuIFJlc3VsdHMgYXJlIG1hcHBlZCBiYWNrIHRvIHJvb3QgbW9kZWxzIGJ5XG4gKiBwcmltYXJ5IGtleSBhbmQgYXR0YWNoZWQgdmlhIGBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKWAgZm9yIGV2ZXJ5XG4gKiBzZWxlY3RlZCBhbGlhcyAoZXhjZXB0IHRoZSByZXNlcnZlZCBgcGFyZW50X2lkYCkuIFJvd3MgbWlzc2luZyBmcm9tXG4gKiB0aGUgcmVzdWx0IGtlZXAgYG51bGxgIOKAlCBtYXRjaGVzIHRoZSBmZWF0dXJlJ3MgZG9jdW1lbnRlZCBkZWZhdWx0LlxuICpcbiAqIE1pcnJvcnMgdGhlIHNoYXBlIG9mIGBydW5XaXRoQ291bnRgOiBvbmUgcXVlcnkgcGVyIGVudHJ5LCBhIHNlcGFyYXRlXG4gKiBzdG9yYWdlIG1hcCBvbiB0aGUgcmVjb3JkLCBuZXZlciB0b3VjaGVzIGBfYXR0cmlidXRlc2AuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5yb290TW9kZWxDbGFzcyAtIFJvb3QgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3Mucm9vdE1vZGVscyAtIExvYWRlZCByb290IHJlY29yZHMuXG4gKiBAcGFyYW0ge1F1ZXJ5RGF0YUVudHJ5W119IGFyZ3MuZW50cmllcyAtIE5vcm1hbGl6ZWQgcXVlcnlEYXRhIGVudHJpZXMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blF1ZXJ5RGF0YSh7cm9vdE1vZGVsQ2xhc3MsIHJvb3RNb2RlbHMsIGVudHJpZXN9KSB7XG4gIGlmIChyb290TW9kZWxzLmxlbmd0aCA9PT0gMCB8fCBlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShyb290TW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBxdWVyeURhdGEgZm9yICR7cm9vdE1vZGVsQ2xhc3MubmFtZX1gKVxuICBjb25zdCByb290SWRzID0gcm9vdE1vZGVscy5tYXAoKG1vZGVsKSA9PiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpKVxuICBjb25zdCBzb3VyY2VNb2RlbCA9IHJvb3RNb2RlbHNbMF1cbiAgY29uc3QgcHJlcGFyZWRFbnRyaWVzID0gZW50cmllcy5tYXAoKGVudHJ5LCBlbnRyeUluZGV4KSA9PiBwcmVwYXJlRW50cnkoe1xuICAgIGVudHJ5LFxuICAgIGVudHJ5SW5kZXgsXG4gICAgcHJpbWFyeUtleSxcbiAgICByb290SWRzLFxuICAgIHJvb3RNb2RlbENsYXNzLFxuICAgIHNvdXJjZU1vZGVsXG4gIH0pKVxuICAvKipcbiAgICogQ29tcGF0aWJsZSBxdWVyeSBncm91cHMuXG4gICAqIEB0eXBlIHtBcnJheTx7YWxpYXNlczogU2V0PHN0cmluZz4sIHF1ZXJ5OiBpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQsIHNpZ25hdHVyZTogc3RyaW5nfT59ICovXG4gIGNvbnN0IHF1ZXJ5R3JvdXBzID0gW11cblxuICBmb3IgKGNvbnN0IHByZXBhcmVkRW50cnkgb2YgcHJlcGFyZWRFbnRyaWVzKSB7XG4gICAgY29uc3QgY29tcGF0aWJsZUdyb3VwID0gcXVlcnlHcm91cHMuZmluZCgoZ3JvdXAsIGdyb3VwSW5kZXgpID0+IHtcbiAgICAgIGlmIChncm91cC5zaWduYXR1cmUgIT09IHByZXBhcmVkRW50cnkuc2lnbmF0dXJlKSByZXR1cm4gZmFsc2VcbiAgICAgIGlmIChxdWVyeUdyb3Vwcy5zbGljZShncm91cEluZGV4ICsgMSkuc29tZSgoaW50ZXJ2ZW5pbmdHcm91cCkgPT4gKFxuICAgICAgICBwcmVwYXJlZEVudHJ5LmFsaWFzZXMuc29tZSgoYWxpYXMpID0+IGludGVydmVuaW5nR3JvdXAuYWxpYXNlcy5oYXMoYWxpYXMpKVxuICAgICAgKSkpIHJldHVybiBmYWxzZVxuXG4gICAgICByZXR1cm4gcHJlcGFyZWRFbnRyeS5hbGlhc2VzLmV2ZXJ5KChhbGlhcykgPT4gIWdyb3VwLmFsaWFzZXMuaGFzKGFsaWFzKSlcbiAgICB9KVxuXG4gICAgaWYgKGNvbXBhdGlibGVHcm91cCkge1xuICAgICAgY29tcGF0aWJsZUdyb3VwLnF1ZXJ5LnNlbGVjdChwcmVwYXJlZEVudHJ5LnF1ZXJ5LmdldFNlbGVjdHMoKS5zbGljZSgxKSlcbiAgICAgIGZvciAoY29uc3QgYWxpYXMgb2YgcHJlcGFyZWRFbnRyeS5hbGlhc2VzKSBjb21wYXRpYmxlR3JvdXAuYWxpYXNlcy5hZGQoYWxpYXMpXG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5R3JvdXBzLnB1c2goe1xuICAgICAgICBhbGlhc2VzOiBuZXcgU2V0KHByZXBhcmVkRW50cnkuYWxpYXNlcyksXG4gICAgICAgIHF1ZXJ5OiBwcmVwYXJlZEVudHJ5LnF1ZXJ5LFxuICAgICAgICBzaWduYXR1cmU6IHByZXBhcmVkRW50cnkuc2lnbmF0dXJlXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3Qge3F1ZXJ5fSBvZiBxdWVyeUdyb3Vwcykge1xuICAgIGF3YWl0IGV4ZWN1dGVDaHVua2VkRW50cnlRdWVyeSh7cHJpbWFyeUtleSwgcXVlcnksIHJvb3RJZHMsIHJvb3RNb2RlbHN9KVxuICB9XG59XG5cbi8qKlxuICogUHJlcGFyZXMgb25lIHF1ZXJ5RGF0YSBlbnRyeSBhbmQgaXRzIGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1F1ZXJ5RGF0YUVudHJ5fSBhcmdzLmVudHJ5IC0gRW50cnkgYmVpbmcgZXZhbHVhdGVkLlxuICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZW50cnlJbmRleCAtIFN0YWJsZSBwb3NpdGlvbiB1c2VkIHRvIGlzb2xhdGUgb3BhcXVlIHByb2plY3Rpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJpbWFyeUtleSAtIFJvb3QgbW9kZWwgcHJpbWFyeSBrZXkgY29sdW1uLlxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnJvb3RJZHMgLSBSb290IHByaW1hcnkta2V5IHZhbHVlcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJvb3RNb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3Muc291cmNlTW9kZWwgLSBMb2FkZWQgb3BlcmF0aW9uIG93bmVyLlxuICogQHJldHVybnMge3thbGlhc2VzOiBzdHJpbmdbXSwgcXVlcnk6IGltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCwgc2lnbmF0dXJlOiBzdHJpbmd9fSAtIFByZXBhcmVkIGVudHJ5LlxuICovXG5mdW5jdGlvbiBwcmVwYXJlRW50cnkoe2VudHJ5LCBlbnRyeUluZGV4LCBwcmltYXJ5S2V5LCByb290SWRzLCByb290TW9kZWxDbGFzcywgc291cmNlTW9kZWx9KSB7XG4gIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZXNvbHZlVGFyZ2V0TW9kZWxDbGFzcyhyb290TW9kZWxDbGFzcywgZW50cnkuY2hhaW4pXG4gIGNvbnN0IGZuID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRRdWVyeURhdGFCeU5hbWUoZW50cnkuZm5OYW1lKVxuXG4gIGlmICghZm4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5RGF0YTogJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9IGhhcyBubyBlbnRyeSByZWdpc3RlcmVkIGFzICR7SlNPTi5zdHJpbmdpZnkoZW50cnkuZm5OYW1lKX0uIGAgK1xuICAgICAgYERlY2xhcmUgaXQgd2l0aCAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0ucXVlcnlEYXRhKCR7SlNPTi5zdHJpbmdpZnkoZW50cnkuZm5OYW1lKX0sICh7cXVlcnksIHRhYmxlTmFtZX0pID0+IHF1ZXJ5LnNlbGVjdCguLi4pKWApXG4gIH1cblxuICBjb25zdCBxdWVyeSA9IHNvdXJjZU1vZGVsLnF1ZXJ5Rm9yTW9kZWwocm9vdE1vZGVsQ2xhc3MpXG5cbiAgLy8gRW1wdHkgb3V0IGFueSBkZWZhdWx0cyB0aGUgcXVlcnkgZmFjdG9yeSBhZGRlZCDigJQgcXVlcnlEYXRhIHJ1bnNcbiAgLy8gYSBiYXJlIGFnZ3JlZ2F0ZSwgbm90IGEgZnVsbCBtb2RlbCBsb2FkLlxuICBxdWVyeS5yZXNlbGVjdCgpXG4gIHF1ZXJ5Ll9wcmVsb2FkID0ge31cblxuICAvLyBGb3JjZSB0aGUgcm9vdCBXSEVSRSB0byBxdWFsaWZ5IGJ5IHRhYmxlIG5hbWUgc28gaXQgc3Vydml2ZXMgdGhlXG4gIC8vIGpvaW5zIHRoZSBmbiBtYXkgYWRkIGxhdGVyIChvdGhlcndpc2UgYSBjaGlsZCB0YWJsZSBzaGFyaW5nIHRoZVxuICAvLyByb290IFBLIGNvbHVtbiBuYW1lLCBlLmcuIGBpZGAsIG1ha2VzIHRoZSBjbGF1c2UgYW1iaWd1b3VzKS5cbiAgcXVlcnkuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZSA9IHRydWVcblxuICBjb25zdCBkcml2ZXIgPSBxdWVyeS5kcml2ZXJcbiAgY29uc3Qgcm9vdFRhYmxlID0gcm9vdE1vZGVsQ2xhc3MudGFibGVOYW1lKClcbiAgY29uc3Qgcm9vdFBrU3FsID0gYCR7ZHJpdmVyLnF1b3RlVGFibGUocm9vdFRhYmxlKX0uJHtkcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YFxuXG4gIGNvbnN0IGpvaW5EZXNjcmlwdG9yID0gYnVpbGROZXN0ZWRKb2luRGVzY3JpcHRvcihlbnRyeS5jaGFpbilcblxuICBpZiAoam9pbkRlc2NyaXB0b3IgIT09IHRydWUpIHtcbiAgICBxdWVyeS5qb2lucyhqb2luRGVzY3JpcHRvcilcbiAgfVxuXG4gIHF1ZXJ5Lmdyb3VwKHJvb3RQa1NxbClcbiAgcXVlcnkuc2VsZWN0KGAke3Jvb3RQa1NxbH0gQVMgcGFyZW50X2lkYClcblxuICBjb25zdCB0YXJnZXRUYWJsZVJlZiA9IGVudHJ5LmNoYWluLmxlbmd0aCA9PT0gMFxuICAgID8gcm9vdFRhYmxlXG4gICAgOiBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4uZW50cnkuY2hhaW4pXG5cbiAgLy8gTkI6IHdlIGludGVudGlvbmFsbHkgbGVhdmUgYF9qb2luQmFzZVBhdGhgIGF0IFtdIHNvIHRoZSBvdXRlciBjaGFpblxuICAvLyBqb2lucyBjb250aW51ZSB0byByZXNvbHZlIGZyb20gdGhlIHJvb3QgbW9kZWwgYXQgcmVuZGVyIHRpbWUuIFRoZVxuICAvLyBmbiBnZXRzIGB0YWJsZU5hbWVgIGZvciBzZWxmLXJlZmVyZW5jZTsgYWRkaXRpb25hbCBqb2lucyBmcm9tXG4gIC8vIG5lc3RlZCBsZXZlbHMgc2hvdWxkIHVzZSBmdWxsIHBhdGhzIGZyb20gdGhlIHJvb3QuXG4gIGZuKHtcbiAgICBhdHRyaWJ1dGVOYW1lOiBlbnRyeS5mbk5hbWUsXG4gICAgZHJpdmVyLFxuICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgcGFyZW50SWRzOiByb290SWRzLFxuICAgIHF1ZXJ5LFxuICAgIHRhYmxlTmFtZTogdGFyZ2V0VGFibGVSZWZcbiAgfSlcblxuICBjb25zdCBhbGlhc2VzID0gc2VsZWN0ZWRBbGlhc2VzKHF1ZXJ5KVxuICBjb25zdCBzaWduYXR1cmVRdWVyeSA9IHF1ZXJ5LmNsb25lKClcbiAgc2lnbmF0dXJlUXVlcnkucmVzZWxlY3Qoc2lnbmF0dXJlUXVlcnkuZ2V0U2VsZWN0cygpLnNsaWNlKDAsIDEpKVxuXG4gIHJldHVybiB7XG4gICAgYWxpYXNlczogYWxpYXNlcyB8fCBbXSxcbiAgICBxdWVyeSxcbiAgICBzaWduYXR1cmU6IGFsaWFzZXMgPyBzaWduYXR1cmVRdWVyeS50b1NxbCgpIDogYG9wYXF1ZToke2VudHJ5SW5kZXh9YFxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBleHBsaWNpdCBhbGlhc2VzIHNlbGVjdGVkIGFmdGVyIHRoZSByZXNlcnZlZCBwYXJlbnQgaWQuXG4gKiBFbnRyaWVzIHdpdGggYW4gb3BhcXVlIHNlbGVjdCBzdGF5IGlzb2xhdGVkIGJ5IHJlY2VpdmluZyBhIHVuaXF1ZSBjb21wYXRpYmlsaXR5IGFsaWFzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUHJlcGFyZWQgcXVlcnlEYXRhIHF1ZXJ5LlxuICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBTZWxlY3RlZCBhbGlhc2VzLCBvciBudWxsIGZvciBhbiBvcGFxdWUgcHJvamVjdGlvbi5cbiAqL1xuZnVuY3Rpb24gc2VsZWN0ZWRBbGlhc2VzKHF1ZXJ5KSB7XG4gIGNvbnN0IGFsaWFzZXMgPSBbXVxuXG4gIGZvciAoY29uc3Qgc2VsZWN0IG9mIHF1ZXJ5LmdldFNlbGVjdHMoKS5zbGljZSgxKSkge1xuICAgIGNvbnN0IGFsaWFzID0gc2VsZWN0LmdldEFsaWFzKClcblxuICAgIGlmICghYWxpYXMpIHJldHVybiBudWxsXG5cbiAgICBhbGlhc2VzLnB1c2goYWxpYXMpXG4gIH1cblxuICByZXR1cm4gYWxpYXNlc1xufVxuXG4vKipcbiAqIEV4ZWN1dGVzIG9uZSBjb21wYXRpYmxlIHF1ZXJ5RGF0YSBncm91cCBhbmQgYXR0YWNoZXMgZXZlcnkgc2VsZWN0ZWQgYWxpYXMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcmltYXJ5S2V5IC0gUm9vdCBtb2RlbCBwcmltYXJ5IGtleSBjb2x1bW4uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFByZXBhcmVkIGdyb3VwZWQgcXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3Mucm9vdE1vZGVscyAtIExvYWRlZCByb290IHJlY29yZHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZUVudHJ5UXVlcnkoe3ByaW1hcnlLZXksIHF1ZXJ5LCByb290TW9kZWxzfSkge1xuICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqLyAoYXdhaXQgcXVlcnkuX2V4ZWN1dGVRdWVyeSgpKVxuICBjb25zdCBieVBhcmVudCA9IG5ldyBNYXAoKVxuXG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBwYXJlbnRJZCA9IHJvdy5wYXJlbnRfaWRcblxuICAgIGlmIChwYXJlbnRJZCA9PSBudWxsKSBjb250aW51ZVxuXG4gICAgYnlQYXJlbnQuc2V0KHBhcmVudElkLCByb3cpXG4gIH1cblxuICBmb3IgKGNvbnN0IG1vZGVsIG9mIHJvb3RNb2RlbHMpIHtcbiAgICBjb25zdCBtb2RlbElkID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovIChtb2RlbC5yZWFkQ29sdW1uKHByaW1hcnlLZXkpKVxuICAgIC8vIERyaXZlci10eXBlIHRvbGVyYW5jZTogTXlTUUwgY2FuIHJldHVybiBQS3MgYXMgc3RyaW5ncyBldmVuIHdoZW5cbiAgICAvLyB0aGUgY29sdW1uIGlzIG51bWVyaWMuIEZhbGwgYmFjayB0byBhIHN0cmluZyBsb29rdXAgc28gcmVzdWx0c1xuICAgIC8vIHN0aWxsIGxhbmQgb24gdGhlIHJpZ2h0IG1vZGVsLlxuICAgIGNvbnN0IHJvdyA9IGJ5UGFyZW50Lmhhcyhtb2RlbElkKVxuICAgICAgPyBieVBhcmVudC5nZXQobW9kZWxJZClcbiAgICAgIDogYnlQYXJlbnQuZ2V0KFN0cmluZyhtb2RlbElkKSlcblxuICAgIGlmICghcm93KSBjb250aW51ZVxuXG4gICAgZm9yIChjb25zdCBbY29sdW1uTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJvdykpIHtcbiAgICAgIGlmIChjb2x1bW5OYW1lID09PSBcInBhcmVudF9pZFwiKSBjb250aW51ZVxuXG4gICAgICBtb2RlbC5fc2V0UXVlcnlEYXRhKGNvbHVtbk5hbWUsIHZhbHVlKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEV4ZWN1dGVzIG9uZSBjb21wYXRpYmxlIHF1ZXJ5RGF0YSBncm91cCBpbiBjb2hvcnRzIHNvIHRoZSByb290IElEIElOLWxpc3RcbiAqIHN0YXlzIHdpdGhpbiBkcml2ZXIgbGltaXRzLCBhdHRhY2hpbmcgZWFjaCBzZWxlY3RlZCBhbGlhcyB0byB0aGUgbWF0Y2hpbmdcbiAqIHJvb3QgcmVjb3JkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJpbWFyeUtleSAtIFJvb3QgbW9kZWwgcHJpbWFyeSBrZXkgY29sdW1uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBQcmVwYXJlZCBncm91cGVkIHF1ZXJ5LlxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnJvb3RJZHMgLSBSb290IHByaW1hcnkta2V5IHZhbHVlcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5yb290TW9kZWxzIC0gTG9hZGVkIHJvb3QgcmVjb3Jkcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBleGVjdXRlQ2h1bmtlZEVudHJ5UXVlcnkoe3ByaW1hcnlLZXksIHF1ZXJ5LCByb290SWRzLCByb290TW9kZWxzfSkge1xuICBjb25zdCBkcml2ZXIgPSBxdWVyeS5kcml2ZXJcbiAgY29uc3QgY29ob3J0cyA9IGRyaXZlci5jaHVua1ZhbHVlcyhyb290SWRzLCAoY2h1bmspID0+IHF1ZXJ5LmNsb25lKCkud2hlcmUoe1twcmltYXJ5S2V5XTogY2h1bmt9KS50b1NxbCgpKVxuXG4gIGZvciAoY29uc3QgY29ob3J0IG9mIGNvaG9ydHMpIHtcbiAgICBjb25zdCBjb2hvcnRRdWVyeSA9IHF1ZXJ5LmNsb25lKCkud2hlcmUoe1twcmltYXJ5S2V5XTogY29ob3J0fSlcblxuICAgIGF3YWl0IGV4ZWN1dGVFbnRyeVF1ZXJ5KHtwcmltYXJ5S2V5LCBxdWVyeTogY29ob3J0UXVlcnksIHJvb3RNb2RlbHN9KVxuICB9XG59XG4iXX0=