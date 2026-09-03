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
        const sql = select.toSql();
        const match = sql.match(/\sAS\s+([^\s]+)\s*$/iu);
        if (!match)
            return null;
        aliases.push(match[1].replace(/^["[`]|["`\]]$/gu, ""));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktZGF0YS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS9xdWVyeS1kYXRhLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDN0MsT0FBTyxFQUFDLHFCQUFxQixFQUFDLE1BQU0sa0NBQWtDLENBQUE7QUFFdEU7Ozs7O0dBS0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7O0dBU0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsTUFBTSxVQUFVLHNCQUFzQixDQUFDLElBQUksRUFBRSxLQUFLLEdBQUcsRUFBRTtJQUNyRCxJQUFJLElBQUksSUFBSSxJQUFJO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFM0IsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM3QixPQUFPLENBQUMsRUFBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQzVDLENBQUM7SUFFRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN4Qjs7c0NBRThCO1FBQzlCLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQTtRQUVsQixLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3hCLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzdCLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUMvQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLEtBQUss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QUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUUxRyxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQzdCLE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFFL0QsTUFBTSxpQkFBaUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7SUFDdkUsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5fSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIFF1ZXJ5RGF0YUVudHJ5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBRdWVyeURhdGFFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gY2hhaW4gLSBSZWxhdGlvbnNoaXAgY2hhaW4gZnJvbSB0aGUgcm9vdCBtb2RlbCB0byB0aGUgbW9kZWwgdGhhdCBkZWNsYXJlcyB0aGUgZm4uIEVtcHR5IGZvciBhIHJvb3QtbGV2ZWwgZW50cnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZm5OYW1lIC0gSWRlbnRpZmllciB1bmRlciB3aGljaCB0aGUgZm4gaXMgcmVnaXN0ZXJlZCBvbiB0aGUgZGVjbGFyaW5nIG1vZGVsLlxuICovXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiB8IHtba2V5OiBzdHJpbmddOiB0cnVlIHwgZmFsc2UgfCBzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFF1ZXJ5RGF0YVNwZWNcbiAqL1xuXG4vKipcbiAqIFF1ZXJ5RGF0YUNhbGxiYWNrQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUXVlcnlEYXRhQ2FsbGJhY2tBcmdzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIE5hbWUgdW5kZXIgd2hpY2ggdGhlIGZuIHdhcyByZWdpc3RlcmVkLiBDb252ZW5pZW50IHdoZW4gYSBmbiBpcyByZXVzZWQgYWNyb3NzIGFsaWFzZXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkcml2ZXIgLSBBY3RpdmUgZGF0YWJhc2UgZHJpdmVyLCBmb3IgcXVvdGluZyBoZWxwZXJzIGFuZCB0eXBlLXNwZWNpZmljIFNRTC5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdGhlIGZuIGlzIHJlZ2lzdGVyZWQgb24gKHRoZSBjaGFpbidzIHRhcmdldCkuXG4gKiBAcHJvcGVydHkge0FycmF5PHN0cmluZyB8IG51bWJlcj59IHBhcmVudElkcyAtIFByaW1hcnkta2V5IHZhbHVlcyBvZiB0aGUgbG9hZGVkIHJvb3QgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIEdyb3VwZWQgcXVlcnkgYWxyZWFkeSBqb2luZWQgZG93biB0aGUgY2hhaW4sIGZpbHRlcmVkIGJ5IGBwYXJlbnRJZHNgLCB3aXRoIGBwYXJlbnRfaWRgIHByZS1zZWxlY3RlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBVbnF1b3RlZCB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpIGZvciB0aGUgY2hhaW4ncyB0YXJnZXQsIHJlYWR5IHRvIHBhc3RlIGludG8gU1FMLlxuICovXG5cbi8qKlxuICogUXVlcnlEYXRhRm4gdHlwZS5cbiAqIEB0eXBlZGVmIHsoYXJnczogUXVlcnlEYXRhQ2FsbGJhY2tBcmdzKSA9PiB2b2lkIHwgaW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBRdWVyeURhdGFGblxuICovXG5cbi8qKlxuICogTm9ybWFsaXplIGEgdXNlci1zdXBwbGllZCBxdWVyeURhdGEgc3BlYyBpbnRvIGEgZmxhdCBsaXN0IG9mIGVudHJpZXNcbiAqIHRoZSBydW5uZXIgY2FuIGNvbnN1bWUuIFRoZSBzcGVjIG1pcnJvcnMgdGhlIHNoYXBlIG9mIGBwcmVsb2FkYCwgd2l0aFxuICogdGhlIGltcG9ydGFudCBkaXN0aW5jdGlvbiB0aGF0ICoqbGVhZiBzdHJpbmdzIGFyZSBmbiBuYW1lcyoqLCBub3RcbiAqIGZ1cnRoZXIgcmVsYXRpb25zaGlwIHNlZ21lbnRzLiBOZXN0ZWQga2V5cyBhcmUgcmVsYXRpb25zaGlwIG5hbWVzXG4gKiBhbG9uZyB0aGUgam9pbiBjaGFpbiBmcm9tIHRoZSByb290IG1vZGVsIHRvIHRoZSBkZWNsYXJpbmcgbW9kZWwuXG4gKlxuICogQWNjZXB0ZWQgc2hhcGVzIChhbGwgeWllbGQgdGhlIHNhbWUgZmxhdCBlbnRyaWVzKTpcbiAqICAgXCJmb29cIiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaSIFt7Y2hhaW46IFtdLCBmbk5hbWU6IFwiZm9vXCJ9XVxuICogICBbXCJmb29cIiwgXCJiYXJcIl0gICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBbe2NoYWluOiBbXSwgZm5OYW1lOiBcImZvb1wifSwge2NoYWluOiBbXSwgZm5OYW1lOiBcImJhclwifV1cbiAqICAge2ZvbzogdHJ1ZX0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGkiBbe2NoYWluOiBbXSwgZm5OYW1lOiBcImZvb1wifV1cbiAqICAge3Byb2plY3RzOiBbXCJ0YXNrc0NvdW50XCJdfSAgICAgICAgICAgICAgICAg4oaSIFt7Y2hhaW46IFtcInByb2plY3RzXCJdLCBmbk5hbWU6IFwidGFza3NDb3VudFwifV1cbiAqICAge3Byb2plY3RzOiB7dGFza3M6IFtcInRyYW5zcG9ydFNlY29uZHNTdW1cIiwge3RpbWVsb2dzOiBbXCJ0aW1lU2Vjb25kc1N1bVwiXX1dfX1cbiAqICAgICDihpIgW3tjaGFpbjogW1wicHJvamVjdHNcIixcInRhc2tzXCJdLCBmbk5hbWU6IFwidHJhbnNwb3J0U2Vjb25kc1N1bVwifSxcbiAqICAgICAgICB7Y2hhaW46IFtcInByb2plY3RzXCIsXCJ0YXNrc1wiLFwidGltZWxvZ3NcIl0sIGZuTmFtZTogXCJ0aW1lU2Vjb25kc1N1bVwifV1cbiAqIEBwYXJhbSB7UXVlcnlEYXRhU3BlY30gc3BlYyAtIFVzZXItc3VwcGxpZWQgc3BlYy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtjaGFpbl0gLSBDdXJyZW50IGNoYWluIChpbnRlcm5hbCByZWN1cnNpb24pLlxuICogQHJldHVybnMge1F1ZXJ5RGF0YUVudHJ5W119IC0gRmxhdCBsaXN0IG9mIGVudHJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVRdWVyeURhdGFTcGVjKHNwZWMsIGNoYWluID0gW10pIHtcbiAgaWYgKHNwZWMgPT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFt7Y2hhaW46IFsuLi5jaGFpbl0sIGZuTmFtZTogc3BlY31dXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzcGVjKSkge1xuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge1F1ZXJ5RGF0YUVudHJ5W119ICovXG4gICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2Ygc3BlYykge1xuICAgICAgaWYgKHR5cGVvZiBpdGVtID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGVudHJpZXMucHVzaCh7Y2hhaW46IFsuLi5jaGFpbl0sIGZuTmFtZTogaXRlbX0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KGl0ZW0pKSB7XG4gICAgICAgIGZvciAoY29uc3QgbmVzdGVkIG9mIG5vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGl0ZW0pLCBjaGFpbikpIHtcbiAgICAgICAgICBlbnRyaWVzLnB1c2gobmVzdGVkKVxuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBxdWVyeURhdGEgYXJyYXkgZW50cnk6ICR7dHlwZW9mIGl0ZW19YClcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc1xuICB9XG5cbiAgaWYgKGlzUGxhaW5PYmplY3Qoc3BlYykpIHtcbiAgICAvKipcbiAgICAgKiBFbnRyaWVzLlxuICAgICAqIEB0eXBlIHtRdWVyeURhdGFFbnRyeVtdfSAqL1xuICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3BlYykpIHtcbiAgICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgICBlbnRyaWVzLnB1c2goe2NoYWluOiBbLi4uY2hhaW5dLCBmbk5hbWU6IGtleX0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIGNvbnRpbnVlXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkgfHwgaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBuZXN0ZWQgb2Ygbm9ybWFsaXplUXVlcnlEYXRhU3BlYygvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpLCBbLi4uY2hhaW4sIGtleV0pKSB7XG4gICAgICAgICAgZW50cmllcy5wdXNoKG5lc3RlZClcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIHZhbHVlIGZvciBcIiR7a2V5fVwiOiAke3R5cGVvZiB2YWx1ZX1gKVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIHNwZWM6ICR7dHlwZW9mIHNwZWN9YClcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgbmVzdGVkIGBqb2lucyguLi4pYCBkZXNjcmlwdG9yIGZvciBhIGNoYWluIG9mIHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAqIGBbXCJwcm9qZWN0c1wiLCBcInRhc2tzXCJdYCDihpIgYHtwcm9qZWN0czoge3Rhc2tzOiB0cnVlfX1gLiBVc2VkIGludGVybmFsbHkgc29cbiAqIHRoZSBydW5uZXIgY2FuIHJldXNlIHRoZSBleGlzdGluZyBgam9pbnNgIHBhdGgtcmVnaXN0cmF0aW9uIG1hY2hpbmVyeVxuICogKEpvaW5UcmFja2VyLCBhbGlhcyBnZW5lcmF0aW9uLCBzY29wZSBhcHBsaWNhdGlvbikuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBjaGFpbiAtIFJlbGF0aW9uc2hpcCBjaGFpbi5cbiAqIEByZXR1cm5zIHt0cnVlIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE5lc3RlZCBqb2luIGRlc2NyaXB0b3IsIG9yIGB0cnVlYCB3aGVuIHRoZSBjaGFpbiBpcyBlbXB0eS5cbiAqL1xuZnVuY3Rpb24gYnVpbGROZXN0ZWRKb2luRGVzY3JpcHRvcihjaGFpbikge1xuICBpZiAoY2hhaW4ubGVuZ3RoID09PSAwKSByZXR1cm4gdHJ1ZVxuXG4gIC8qKlxuICAgKiBPYmouXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IG9iaiA9IHt9XG4gIGxldCBjdXJzb3IgPSBvYmpcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGNoYWluLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3Qgc2VnID0gY2hhaW5baV1cbiAgICBjb25zdCBpc0xhc3QgPSBpID09PSBjaGFpbi5sZW5ndGggLSAxXG5cbiAgICBjdXJzb3Jbc2VnXSA9IGlzTGFzdCA/IHRydWUgOiB7fVxuXG4gICAgaWYgKCFpc0xhc3QpIGN1cnNvciA9IGN1cnNvcltzZWddXG4gIH1cblxuICByZXR1cm4gb2JqXG59XG5cbi8qKlxuICogV2FsayBhIHJlbGF0aW9uc2hpcCBjaGFpbiBmcm9tIHRoZSByb290IG1vZGVsIGFuZCByZXR1cm4gdGhlIG1vZGVsXG4gKiBjbGFzcyBhdCBpdHMgdGFpbC4gVGhyb3dzIHdpdGggYSBjbGVhciBtZXNzYWdlIHdoZW4gYW55IHNlZ21lbnQgaXNcbiAqIHVua25vd24uXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcm9vdE1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gY2hhaW4gLSBSZWxhdGlvbnNoaXAgY2hhaW4uXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVRhcmdldE1vZGVsQ2xhc3Mocm9vdE1vZGVsQ2xhc3MsIGNoYWluKSB7XG4gIGxldCBtb2RlbENsYXNzID0gcm9vdE1vZGVsQ2xhc3NcblxuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2YgY2hhaW4pIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShzZWdtZW50KVxuICAgIGNvbnN0IHJhd1RhcmdldCA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5RGF0YTogY291bGQgbm90IHJlc29sdmUgdGFyZ2V0IG1vZGVsIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHtzZWdtZW50fWApXG4gICAgfVxuXG4gICAgbW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXQpXG4gIH1cblxuICByZXR1cm4gbW9kZWxDbGFzc1xufVxuXG4vKipcbiAqIFJ1biBldmVyeSBxdWVyeURhdGEgZW50cnkgYWdhaW5zdCB0aGUgbG9hZGVkIHJvb3QgcmVjb3JkcywgYXR0YWNoaW5nXG4gKiB0aGUgcmVzdWx0aW5nIHZhbHVlcyBhcyBxdWVyeURhdGEgZW50cmllcyBvbiBlYWNoIHJvb3QgcmVjb3JkLlxuICpcbiAqIE9uZSBncm91cGVkIHF1ZXJ5IHBlciBlbnRyeTogdGhlIHJ1bm5lciBidWlsZHMgYSBmcmVzaCBxdWVyeSBvdmVyIHRoZVxuICogcm9vdCBtb2RlbCwgam9pbnMgZG93biB0aGUgY2hhaW4sIGdyb3VwcyBieSB0aGUgcm9vdCB0YWJsZSdzIHByaW1hcnlcbiAqIGtleSwgYW5kIGludm9rZXMgdGhlIHJlZ2lzdGVyZWQgZm4gdG8gYWRkIGl0cyBvd24gU0VMRUNUIChhbmQgYW55XG4gKiBhZGRpdGlvbmFsIGpvaW5zL3doZXJlKS4gUmVzdWx0cyBhcmUgbWFwcGVkIGJhY2sgdG8gcm9vdCBtb2RlbHMgYnlcbiAqIHByaW1hcnkga2V5IGFuZCBhdHRhY2hlZCB2aWEgYF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpYCBmb3IgZXZlcnlcbiAqIHNlbGVjdGVkIGFsaWFzIChleGNlcHQgdGhlIHJlc2VydmVkIGBwYXJlbnRfaWRgKS4gUm93cyBtaXNzaW5nIGZyb21cbiAqIHRoZSByZXN1bHQga2VlcCBgbnVsbGAg4oCUIG1hdGNoZXMgdGhlIGZlYXR1cmUncyBkb2N1bWVudGVkIGRlZmF1bHQuXG4gKlxuICogTWlycm9ycyB0aGUgc2hhcGUgb2YgYHJ1bldpdGhDb3VudGA6IG9uZSBxdWVyeSBwZXIgZW50cnksIGEgc2VwYXJhdGVcbiAqIHN0b3JhZ2UgbWFwIG9uIHRoZSByZWNvcmQsIG5ldmVyIHRvdWNoZXMgYF9hdHRyaWJ1dGVzYC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJvb3RNb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5yb290TW9kZWxzIC0gTG9hZGVkIHJvb3QgcmVjb3Jkcy5cbiAqIEBwYXJhbSB7UXVlcnlEYXRhRW50cnlbXX0gYXJncy5lbnRyaWVzIC0gTm9ybWFsaXplZCBxdWVyeURhdGEgZW50cmllcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuUXVlcnlEYXRhKHtyb290TW9kZWxDbGFzcywgcm9vdE1vZGVscywgZW50cmllc30pIHtcbiAgaWYgKHJvb3RNb2RlbHMubGVuZ3RoID09PSAwIHx8IGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KHJvb3RNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYHF1ZXJ5RGF0YSBmb3IgJHtyb290TW9kZWxDbGFzcy5uYW1lfWApXG4gIGNvbnN0IHJvb3RJZHMgPSByb290TW9kZWxzLm1hcCgobW9kZWwpID0+IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAobW9kZWwucmVhZENvbHVtbihwcmltYXJ5S2V5KSkpXG4gIGNvbnN0IHNvdXJjZU1vZGVsID0gcm9vdE1vZGVsc1swXVxuICBjb25zdCBwcmVwYXJlZEVudHJpZXMgPSBlbnRyaWVzLm1hcCgoZW50cnksIGVudHJ5SW5kZXgpID0+IHByZXBhcmVFbnRyeSh7XG4gICAgZW50cnksXG4gICAgZW50cnlJbmRleCxcbiAgICBwcmltYXJ5S2V5LFxuICAgIHJvb3RJZHMsXG4gICAgcm9vdE1vZGVsQ2xhc3MsXG4gICAgc291cmNlTW9kZWxcbiAgfSkpXG4gIC8qKlxuICAgKiBDb21wYXRpYmxlIHF1ZXJ5IGdyb3Vwcy5cbiAgICogQHR5cGUge0FycmF5PHthbGlhc2VzOiBTZXQ8c3RyaW5nPiwgcXVlcnk6IGltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCwgc2lnbmF0dXJlOiBzdHJpbmd9Pn0gKi9cbiAgY29uc3QgcXVlcnlHcm91cHMgPSBbXVxuXG4gIGZvciAoY29uc3QgcHJlcGFyZWRFbnRyeSBvZiBwcmVwYXJlZEVudHJpZXMpIHtcbiAgICBjb25zdCBjb21wYXRpYmxlR3JvdXAgPSBxdWVyeUdyb3Vwcy5maW5kKChncm91cCwgZ3JvdXBJbmRleCkgPT4ge1xuICAgICAgaWYgKGdyb3VwLnNpZ25hdHVyZSAhPT0gcHJlcGFyZWRFbnRyeS5zaWduYXR1cmUpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKHF1ZXJ5R3JvdXBzLnNsaWNlKGdyb3VwSW5kZXggKyAxKS5zb21lKChpbnRlcnZlbmluZ0dyb3VwKSA9PiAoXG4gICAgICAgIHByZXBhcmVkRW50cnkuYWxpYXNlcy5zb21lKChhbGlhcykgPT4gaW50ZXJ2ZW5pbmdHcm91cC5hbGlhc2VzLmhhcyhhbGlhcykpXG4gICAgICApKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiBwcmVwYXJlZEVudHJ5LmFsaWFzZXMuZXZlcnkoKGFsaWFzKSA9PiAhZ3JvdXAuYWxpYXNlcy5oYXMoYWxpYXMpKVxuICAgIH0pXG5cbiAgICBpZiAoY29tcGF0aWJsZUdyb3VwKSB7XG4gICAgICBjb21wYXRpYmxlR3JvdXAucXVlcnkuc2VsZWN0KHByZXBhcmVkRW50cnkucXVlcnkuZ2V0U2VsZWN0cygpLnNsaWNlKDEpKVxuICAgICAgZm9yIChjb25zdCBhbGlhcyBvZiBwcmVwYXJlZEVudHJ5LmFsaWFzZXMpIGNvbXBhdGlibGVHcm91cC5hbGlhc2VzLmFkZChhbGlhcylcbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnlHcm91cHMucHVzaCh7XG4gICAgICAgIGFsaWFzZXM6IG5ldyBTZXQocHJlcGFyZWRFbnRyeS5hbGlhc2VzKSxcbiAgICAgICAgcXVlcnk6IHByZXBhcmVkRW50cnkucXVlcnksXG4gICAgICAgIHNpZ25hdHVyZTogcHJlcGFyZWRFbnRyeS5zaWduYXR1cmVcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgZm9yIChjb25zdCB7cXVlcnl9IG9mIHF1ZXJ5R3JvdXBzKSB7XG4gICAgYXdhaXQgZXhlY3V0ZUNodW5rZWRFbnRyeVF1ZXJ5KHtwcmltYXJ5S2V5LCBxdWVyeSwgcm9vdElkcywgcm9vdE1vZGVsc30pXG4gIH1cbn1cblxuLyoqXG4gKiBQcmVwYXJlcyBvbmUgcXVlcnlEYXRhIGVudHJ5IGFuZCBpdHMgY29tcGF0aWJpbGl0eSBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UXVlcnlEYXRhRW50cnl9IGFyZ3MuZW50cnkgLSBFbnRyeSBiZWluZyBldmFsdWF0ZWQuXG4gKiBAcGFyYW0ge251bWJlcn0gYXJncy5lbnRyeUluZGV4IC0gU3RhYmxlIHBvc2l0aW9uIHVzZWQgdG8gaXNvbGF0ZSBvcGFxdWUgcHJvamVjdGlvbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcmltYXJ5S2V5IC0gUm9vdCBtb2RlbCBwcmltYXJ5IGtleSBjb2x1bW4uXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IG51bWJlcj59IGFyZ3Mucm9vdElkcyAtIFJvb3QgcHJpbWFyeS1rZXkgdmFsdWVzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3Mucm9vdE1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5zb3VyY2VNb2RlbCAtIExvYWRlZCBvcGVyYXRpb24gb3duZXIuXG4gKiBAcmV0dXJucyB7e2FsaWFzZXM6IHN0cmluZ1tdLCBxdWVyeTogaW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0LCBzaWduYXR1cmU6IHN0cmluZ319IC0gUHJlcGFyZWQgZW50cnkuXG4gKi9cbmZ1bmN0aW9uIHByZXBhcmVFbnRyeSh7ZW50cnksIGVudHJ5SW5kZXgsIHByaW1hcnlLZXksIHJvb3RJZHMsIHJvb3RNb2RlbENsYXNzLCBzb3VyY2VNb2RlbH0pIHtcbiAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlc29sdmVUYXJnZXRNb2RlbENsYXNzKHJvb3RNb2RlbENsYXNzLCBlbnRyeS5jaGFpbilcbiAgY29uc3QgZm4gPSB0YXJnZXRNb2RlbENsYXNzLmdldFF1ZXJ5RGF0YUJ5TmFtZShlbnRyeS5mbk5hbWUpXG5cbiAgaWYgKCFmbikge1xuICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhOiAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0gaGFzIG5vIGVudHJ5IHJlZ2lzdGVyZWQgYXMgJHtKU09OLnN0cmluZ2lmeShlbnRyeS5mbk5hbWUpfS4gYCArXG4gICAgICBgRGVjbGFyZSBpdCB3aXRoICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfS5xdWVyeURhdGEoJHtKU09OLnN0cmluZ2lmeShlbnRyeS5mbk5hbWUpfSwgKHtxdWVyeSwgdGFibGVOYW1lfSkgPT4gcXVlcnkuc2VsZWN0KC4uLikpYClcbiAgfVxuXG4gIGNvbnN0IHF1ZXJ5ID0gc291cmNlTW9kZWwucXVlcnlGb3JNb2RlbChyb290TW9kZWxDbGFzcylcblxuICAvLyBFbXB0eSBvdXQgYW55IGRlZmF1bHRzIHRoZSBxdWVyeSBmYWN0b3J5IGFkZGVkIOKAlCBxdWVyeURhdGEgcnVuc1xuICAvLyBhIGJhcmUgYWdncmVnYXRlLCBub3QgYSBmdWxsIG1vZGVsIGxvYWQuXG4gIHF1ZXJ5LnJlc2VsZWN0KClcbiAgcXVlcnkuX3ByZWxvYWQgPSB7fVxuXG4gIC8vIEZvcmNlIHRoZSByb290IFdIRVJFIHRvIHF1YWxpZnkgYnkgdGFibGUgbmFtZSBzbyBpdCBzdXJ2aXZlcyB0aGVcbiAgLy8gam9pbnMgdGhlIGZuIG1heSBhZGQgbGF0ZXIgKG90aGVyd2lzZSBhIGNoaWxkIHRhYmxlIHNoYXJpbmcgdGhlXG4gIC8vIHJvb3QgUEsgY29sdW1uIG5hbWUsIGUuZy4gYGlkYCwgbWFrZXMgdGhlIGNsYXVzZSBhbWJpZ3VvdXMpLlxuICBxdWVyeS5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gdHJ1ZVxuXG4gIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICBjb25zdCByb290VGFibGUgPSByb290TW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuICBjb25zdCByb290UGtTcWwgPSBgJHtkcml2ZXIucXVvdGVUYWJsZShyb290VGFibGUpfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KX1gXG5cbiAgY29uc3Qgam9pbkRlc2NyaXB0b3IgPSBidWlsZE5lc3RlZEpvaW5EZXNjcmlwdG9yKGVudHJ5LmNoYWluKVxuXG4gIGlmIChqb2luRGVzY3JpcHRvciAhPT0gdHJ1ZSkge1xuICAgIHF1ZXJ5LmpvaW5zKGpvaW5EZXNjcmlwdG9yKVxuICB9XG5cbiAgcXVlcnkuZ3JvdXAocm9vdFBrU3FsKVxuICBxdWVyeS5zZWxlY3QoYCR7cm9vdFBrU3FsfSBBUyBwYXJlbnRfaWRgKVxuXG4gIGNvbnN0IHRhcmdldFRhYmxlUmVmID0gZW50cnkuY2hhaW4ubGVuZ3RoID09PSAwXG4gICAgPyByb290VGFibGVcbiAgICA6IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5lbnRyeS5jaGFpbilcblxuICAvLyBOQjogd2UgaW50ZW50aW9uYWxseSBsZWF2ZSBgX2pvaW5CYXNlUGF0aGAgYXQgW10gc28gdGhlIG91dGVyIGNoYWluXG4gIC8vIGpvaW5zIGNvbnRpbnVlIHRvIHJlc29sdmUgZnJvbSB0aGUgcm9vdCBtb2RlbCBhdCByZW5kZXIgdGltZS4gVGhlXG4gIC8vIGZuIGdldHMgYHRhYmxlTmFtZWAgZm9yIHNlbGYtcmVmZXJlbmNlOyBhZGRpdGlvbmFsIGpvaW5zIGZyb21cbiAgLy8gbmVzdGVkIGxldmVscyBzaG91bGQgdXNlIGZ1bGwgcGF0aHMgZnJvbSB0aGUgcm9vdC5cbiAgZm4oe1xuICAgIGF0dHJpYnV0ZU5hbWU6IGVudHJ5LmZuTmFtZSxcbiAgICBkcml2ZXIsXG4gICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICBwYXJlbnRJZHM6IHJvb3RJZHMsXG4gICAgcXVlcnksXG4gICAgdGFibGVOYW1lOiB0YXJnZXRUYWJsZVJlZlxuICB9KVxuXG4gIGNvbnN0IGFsaWFzZXMgPSBzZWxlY3RlZEFsaWFzZXMocXVlcnkpXG4gIGNvbnN0IHNpZ25hdHVyZVF1ZXJ5ID0gcXVlcnkuY2xvbmUoKVxuICBzaWduYXR1cmVRdWVyeS5yZXNlbGVjdChzaWduYXR1cmVRdWVyeS5nZXRTZWxlY3RzKCkuc2xpY2UoMCwgMSkpXG5cbiAgcmV0dXJuIHtcbiAgICBhbGlhc2VzOiBhbGlhc2VzIHx8IFtdLFxuICAgIHF1ZXJ5LFxuICAgIHNpZ25hdHVyZTogYWxpYXNlcyA/IHNpZ25hdHVyZVF1ZXJ5LnRvU3FsKCkgOiBgb3BhcXVlOiR7ZW50cnlJbmRleH1gXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGV4cGxpY2l0IGFsaWFzZXMgc2VsZWN0ZWQgYWZ0ZXIgdGhlIHJlc2VydmVkIHBhcmVudCBpZC5cbiAqIEVudHJpZXMgd2l0aCBhbiBvcGFxdWUgc2VsZWN0IHN0YXkgaXNvbGF0ZWQgYnkgcmVjZWl2aW5nIGEgdW5pcXVlIGNvbXBhdGliaWxpdHkgYWxpYXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gcXVlcnkgLSBQcmVwYXJlZCBxdWVyeURhdGEgcXVlcnkuXG4gKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIFNlbGVjdGVkIGFsaWFzZXMsIG9yIG51bGwgZm9yIGFuIG9wYXF1ZSBwcm9qZWN0aW9uLlxuICovXG5mdW5jdGlvbiBzZWxlY3RlZEFsaWFzZXMocXVlcnkpIHtcbiAgY29uc3QgYWxpYXNlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBzZWxlY3Qgb2YgcXVlcnkuZ2V0U2VsZWN0cygpLnNsaWNlKDEpKSB7XG4gICAgY29uc3Qgc3FsID0gc2VsZWN0LnRvU3FsKClcbiAgICBjb25zdCBtYXRjaCA9IHNxbC5tYXRjaCgvXFxzQVNcXHMrKFteXFxzXSspXFxzKiQvaXUpXG5cbiAgICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbFxuXG4gICAgYWxpYXNlcy5wdXNoKG1hdGNoWzFdLnJlcGxhY2UoL15bXCJbYF18W1wiYFxcXV0kL2d1LCBcIlwiKSlcbiAgfVxuXG4gIHJldHVybiBhbGlhc2VzXG59XG5cbi8qKlxuICogRXhlY3V0ZXMgb25lIGNvbXBhdGlibGUgcXVlcnlEYXRhIGdyb3VwIGFuZCBhdHRhY2hlcyBldmVyeSBzZWxlY3RlZCBhbGlhcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByaW1hcnlLZXkgLSBSb290IG1vZGVsIHByaW1hcnkga2V5IGNvbHVtbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUHJlcGFyZWQgZ3JvdXBlZCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5yb290TW9kZWxzIC0gTG9hZGVkIHJvb3QgcmVjb3Jkcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBleGVjdXRlRW50cnlRdWVyeSh7cHJpbWFyeUtleSwgcXVlcnksIHJvb3RNb2RlbHN9KSB7XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovIChhd2FpdCBxdWVyeS5fZXhlY3V0ZVF1ZXJ5KCkpXG4gIGNvbnN0IGJ5UGFyZW50ID0gbmV3IE1hcCgpXG5cbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IHBhcmVudElkID0gcm93LnBhcmVudF9pZFxuXG4gICAgaWYgKHBhcmVudElkID09IG51bGwpIGNvbnRpbnVlXG5cbiAgICBieVBhcmVudC5zZXQocGFyZW50SWQsIHJvdylcbiAgfVxuXG4gIGZvciAoY29uc3QgbW9kZWwgb2Ygcm9vdE1vZGVscykge1xuICAgIGNvbnN0IG1vZGVsSWQgPSAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocHJpbWFyeUtleSkpXG4gICAgLy8gRHJpdmVyLXR5cGUgdG9sZXJhbmNlOiBNeVNRTCBjYW4gcmV0dXJuIFBLcyBhcyBzdHJpbmdzIGV2ZW4gd2hlblxuICAgIC8vIHRoZSBjb2x1bW4gaXMgbnVtZXJpYy4gRmFsbCBiYWNrIHRvIGEgc3RyaW5nIGxvb2t1cCBzbyByZXN1bHRzXG4gICAgLy8gc3RpbGwgbGFuZCBvbiB0aGUgcmlnaHQgbW9kZWwuXG4gICAgY29uc3Qgcm93ID0gYnlQYXJlbnQuaGFzKG1vZGVsSWQpXG4gICAgICA/IGJ5UGFyZW50LmdldChtb2RlbElkKVxuICAgICAgOiBieVBhcmVudC5nZXQoU3RyaW5nKG1vZGVsSWQpKVxuXG4gICAgaWYgKCFyb3cpIGNvbnRpbnVlXG5cbiAgICBmb3IgKGNvbnN0IFtjb2x1bW5OYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocm93KSkge1xuICAgICAgaWYgKGNvbHVtbk5hbWUgPT09IFwicGFyZW50X2lkXCIpIGNvbnRpbnVlXG5cbiAgICAgIG1vZGVsLl9zZXRRdWVyeURhdGEoY29sdW1uTmFtZSwgdmFsdWUpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgb25lIGNvbXBhdGlibGUgcXVlcnlEYXRhIGdyb3VwIGluIGNvaG9ydHMgc28gdGhlIHJvb3QgSUQgSU4tbGlzdFxuICogc3RheXMgd2l0aGluIGRyaXZlciBsaW1pdHMsIGF0dGFjaGluZyBlYWNoIHNlbGVjdGVkIGFsaWFzIHRvIHRoZSBtYXRjaGluZ1xuICogcm9vdCByZWNvcmQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcmltYXJ5S2V5IC0gUm9vdCBtb2RlbCBwcmltYXJ5IGtleSBjb2x1bW4uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFByZXBhcmVkIGdyb3VwZWQgcXVlcnkuXG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IG51bWJlcj59IGFyZ3Mucm9vdElkcyAtIFJvb3QgcHJpbWFyeS1rZXkgdmFsdWVzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLnJvb3RNb2RlbHMgLSBMb2FkZWQgcm9vdCByZWNvcmRzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVDaHVua2VkRW50cnlRdWVyeSh7cHJpbWFyeUtleSwgcXVlcnksIHJvb3RJZHMsIHJvb3RNb2RlbHN9KSB7XG4gIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICBjb25zdCBjb2hvcnRzID0gZHJpdmVyLmNodW5rVmFsdWVzKHJvb3RJZHMsIChjaHVuaykgPT4gcXVlcnkuY2xvbmUoKS53aGVyZSh7W3ByaW1hcnlLZXldOiBjaHVua30pLnRvU3FsKCkpXG5cbiAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgIGNvbnN0IGNvaG9ydFF1ZXJ5ID0gcXVlcnkuY2xvbmUoKS53aGVyZSh7W3ByaW1hcnlLZXldOiBjb2hvcnR9KVxuXG4gICAgYXdhaXQgZXhlY3V0ZUVudHJ5UXVlcnkoe3ByaW1hcnlLZXksIHF1ZXJ5OiBjb2hvcnRRdWVyeSwgcm9vdE1vZGVsc30pXG4gIH1cbn1cbiJdfQ==