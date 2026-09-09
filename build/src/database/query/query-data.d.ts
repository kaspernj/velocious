export type QueryDataEntry = {
    /**
     * - Relationship chain from the root model to the model that declares the fn. Empty for a root-level entry.
     */
    chain: string[];
    /**
     * - Identifier under which the fn is registered on the declaring model.
     */
    fnName: string;
};
export type QueryDataSpec = string | Array<string | Record<string, ReturnType<typeof JSON.parse>>> | {
    [key: string]: true | false | string | string[] | Record<string, ReturnType<typeof JSON.parse>>;
};
export type QueryDataCallbackArgs = {
    /**
     * - Name under which the fn was registered. Convenient when a fn is reused across aliases.
     */
    attributeName: string;
    /**
     * - Active database driver, for quoting helpers and type-specific SQL.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Model class the fn is registered on (the chain's target).
     */
    modelClass: typeof import("../record/index.js").default;
    /**
     * - Primary-key values of the loaded root records.
     */
    parentIds: Array<string | number>;
    /**
     * - Grouped query already joined down the chain, filtered by `parentIds`, with `parent_id` pre-selected.
     */
    query: import("./model-class-query.js").default;
    /**
     * - Unquoted table reference (alias or table name) for the chain's target, ready to paste into SQL.
     */
    tableName: string;
};
export type QueryDataFn = (args: QueryDataCallbackArgs) => void | import("./model-class-query.js").default;
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
export declare function normalizeQueryDataSpec(spec: QueryDataSpec, chain?: string[]): QueryDataEntry[];
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
export declare function runQueryData({ rootModelClass, rootModels, entries }: {
    rootModelClass: typeof import("../record/index.js").default;
    rootModels: import("../record/index.js").default[];
    entries: QueryDataEntry[];
}): Promise<void>;
//# sourceMappingURL=query-data.d.ts.map