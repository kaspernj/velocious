import DatabaseQuery from "./index.js";
import JoinTracker from "./join-tracker.js";
export type ModelClassQueryArgsType<MC extends typeof import("../record/index.js").default = typeof import("../record/index.js").default> = import("./index.js").QueryArgsType & {
    modelClass: MC;
    joinBasePath?: string[];
    joinTracker?: import("./join-tracker.js").default;
    forceQualifyBaseTable?: boolean;
    withCount?: import("./with-count.js").WithCountEntry[];
    queryData?: import("./query-data.js").QueryDataEntry[];
    operation?: import("../operation.js").default;
};
/**
 * Defines this typedef.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
export default class VelociousDatabaseQueryModelClassQuery<MC extends typeof import("../record/index.js").default = typeof import("../record/index.js").default> extends DatabaseQuery {
    /**
     * Narrows the runtime value to the documented type.
     * @type {MC} */
    modelClass: MC;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string[]} */
    _joinBasePath: string[];
    _joinTracker: JoinTracker;
    _forceQualifyBaseTable: boolean;
    _operation: import("../operation.js").default | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./with-count.js").WithCountEntry[]} */
    _withCount: import("./with-count.js").WithCountEntry[];
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./query-data.js").QueryDataEntry[]} */
    _queryData: import("./query-data.js").QueryDataEntry[];
    /**
     * Runs constructor.
     * @param {ModelClassQueryArgsType<MC>} args - Query constructor arguments.
     */
    constructor(args: ModelClassQueryArgsType<MC>);
    /**
     * Runs clone.
     * @returns {this} - The clone.
     */
    clone(): this;
    /**
     * Tell the query to attach one or more association counts onto every
     * loaded record. The counts land as regular attributes on each record;
     * read them with `model.readAttribute("<name>Count")`.
     * @param {import("./with-count.js").WithCountSpec} spec - Count spec in shorthand or nested form.
     * @returns {this} - This query, for chaining.
     */
    withCount(spec: import("./with-count.js").WithCountSpec): this;
    /**
     * Attach one or more consumer-defined, per-row computed values onto
     * every loaded root record. Leaf strings in the spec are names of
     * functions previously registered via `Model.queryData(name, fn)`.
     * Nested object keys are relationship names traced from the root to
     * the model that declares the fn. Every resulting SELECT alias is
     * attached to the **root** record (not to the intermediate joined
     * rows); read values with `record.queryData(aliasName)`.
     *
     * See also `src/database/query/query-data.js`.
     * @param {import("./query-data.js").QueryDataSpec} spec - Spec in shorthand or nested form.
     * @returns {this} - This query, for chaining.
     */
    queryData(spec: import("./query-data.js").QueryDataSpec): this;
    /**
     * Return the table reference (alias or table name) registered for the
     * given relationship chain, relative to the query's current join base
     * path. Convenience wrapper around `getTableReferenceForJoin` for use
     * inside `queryData` callbacks where the writer's intent reads more
     * naturally as "give me the table name for 'tasks'".
     * @param {...string} path - Relationship path segments.
     * @returns {string} - Unquoted table reference.
     */
    tableNameFor(...path: string[]): string;
    /**
     * Runs count.
     * @returns {Promise<number>} - Resolves with the count.
     */
    count(): Promise<number>;
    /**
     * Runs paginated count.
     * @returns {Promise<number>} - Resolves with the count after pagination is applied.
     */
    paginatedCount(): Promise<number>;
    /**
     * Runs select.
     * @param {import("./index.js").SelectArgumentType} select - Select.
     * @returns {this} - The select.
     */
    select(select: import("./index.js").SelectArgumentType): this;
    /**
     * Loads the default columns plus the given extra selects for preloaded
     * relationship targets, keyed by target model name, e.g.
     * `.selectsExtra({Account: ["(SELECT count(*) FROM projects) AS projects_count"]})`.
     * Unlike `select({...})`, which narrows to only the listed columns, this keeps
     * the default `SELECT *` columns and adds the extras on top.
     * @param {Record<string, string | string[]>} select - Extra selects keyed by target model name.
     * @returns {this} - This query, for chaining.
     */
    selectsExtra(select: Record<string, string | string[]>): this;
    /**
     * Merges an object-form preload select (keyed by target model name) into the
     * given target map, de-duplicating attribute/expression entries.
     * @param {Record<string, string[]>} target - Map to merge into.
     * @param {Record<string, string | string[]>} select - Object-form select.
     * @returns {void} - No return value.
     */
    _mergePreloadSelect(target: Record<string, string[]>, select: Record<string, string | string[]>): void;
    /**
     * Runs root table reference.
     * @returns {string} - Root table reference for query select qualification.
     */
    rootTableReference(): string;
    /**
     * Runs get model class.
     * @returns {MC} - The model class.
     */
    getModelClass(): MC;
    /**
     * Binds a relationship target to this query's physical database generation.
     * @param {typeof import("../record/index.js").default} modelClass - Canonical relationship target.
     * @returns {typeof import("../record/index.js").default} - Query-bound relationship target.
     */
    bindModelClass(modelClass: typeof import("../record/index.js").default): typeof import("../record/index.js").default;
    /**
     * Runs get join base path.
     * @returns {string[]} - The join base path.
     */
    getJoinBasePath(): string[];
    /**
     * Runs get join tracker.
     * @returns {import("./join-tracker.js").default} - The join tracker.
     */
    getJoinTracker(): import("./join-tracker.js").default;
    /**
     * Runs get force qualify base table.
     * @returns {boolean} - Whether to qualify base table.
     */
    getForceQualifyBaseTable(): boolean;
    /**
     * Runs set join base path.
     * @param {string[]} joinBasePath - Join base path.
     * @returns {this} - The query with updated base path.
     */
    setJoinBasePath(joinBasePath: string[]): this;
    /**
     * Runs with join path.
     * @param {string[]} joinBasePath - Join base path.
     * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped query.
     */
    withJoinPath(joinBasePath: string[]): VelociousDatabaseQueryModelClassQuery<MC>;
    /**
     * Runs resolve table name for join path.
     * @param {string[]} path - Join path.
     * @returns {string} - Table name for path.
     */
    _resolveTableNameForJoinPath(path: string[]): string;
    /**
     * Runs resolve model class for join path.
     * @param {string[]} path - Join path.
     * @returns {typeof import("../record/index.js").default} - Target model class.
     */
    _resolveModelClassForJoinPath(path: string[]): typeof import("../record/index.js").default;
    /**
     * Runs register join path.
     * @param {string[]} path - Join path.
     * @returns {{tableName: string, alias: string | undefined}} - The entry.
     */
    _registerJoinPath(path: string[]): {
        tableName: string;
        alias: string | undefined;
    };
    /**
     * Runs get join table reference.
     * @param {string[]} path - Join path.
     * @returns {string} - Unquoted table reference (alias or table name).
     */
    getJoinTableReference(path: string[]): string;
    /**
     * Runs get table reference for join.
     * @param {...string} path - Join path segments.
     * @returns {string} - Unquoted table reference (alias or table name).
     */
    getTableReferenceForJoin(...path: string[]): string;
    /**
     * Runs get table for join.
     * @param {...string} path - Join path segments.
     * @returns {string} - Quoted table name for join path.
     */
    getTableForJoin(...path: string[]): string;
    /**
     * Runs scope.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor | string | string[]} pathOrScopeDescriptor - Scope descriptor or join path.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} [maybeScopeDescriptor] - Scope descriptor when path is given.
     * @returns {this} - Scoped query.
     */
    scope(pathOrScopeDescriptor: import("../../utils/model-scope.js").ModelScopeDescriptor | string | string[], maybeScopeDescriptor?: import("../../utils/model-scope.js").ModelScopeDescriptor): this;
    /**
     * Runs apply root scope.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    _applyRootScope(scopeDescriptor: import("../../utils/model-scope.js").ModelScopeDescriptor): this;
    /**
     * Runs apply join path scope.
     * @param {object} args - Join-path scope options.
     * @param {string[]} args.joinPath - Join path relative to the current query.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} args.scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    _applyJoinPathScope({ joinPath, scopeDescriptor }: {
        joinPath: string[];
        scopeDescriptor: import("../../utils/model-scope.js").ModelScopeDescriptor;
    }): this;
    /**
     * Runs build join scope query.
     * @param {typeof import("../record/index.js").default} targetModelClass - Target model class.
     * @param {string[]} joinPath - Join path.
     * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped join query.
     */
    buildJoinScopeQuery(targetModelClass: typeof import("../record/index.js").default, joinPath: string[]): VelociousDatabaseQueryModelClassQuery<MC>;
    /**
     * Runs destroy all.
     * @returns {Promise<void>} - Resolves when complete.
     */
    destroyAll(): Promise<void>;
    /**
     * Executes a bulk UPDATE on all rows matching the query's WHERE
     * clause. Bypasses model lifecycle callbacks — use this for
     * efficient batch updates where per-row hooks aren't needed.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - camelCase attribute names → values.
     * @returns {Promise<void>} - Resolves when the update completes.
     */
    updateAll(data: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Runs find.
     * @param {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} recordId - Record id.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
     */
    find(recordId: import("../../utils/model-primary-key.js").ModelPrimaryKeyValue): Promise<InstanceType<MC>>;
    /**
     * Runs find by.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
     */
    findBy(conditions: {
        [key: string]: string | number;
    }): Promise<InstanceType<MC> | null>;
    /**
     * Runs find or create by.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
     */
    findOrCreateBy(conditions: {
        [key: string]: string | number;
    }, callback?: (arg: InstanceType<MC>) => void): Promise<InstanceType<MC>>;
    /**
     * Runs find by or fail.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
     */
    findByOrFail(conditions: {
        [key: string]: string | number;
    }): Promise<InstanceType<MC>>;
    /**
     * Runs find or initialize by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
     */
    findOrInitializeBy(conditions: Record<string, ReturnType<typeof JSON.parse>>, callback?: (arg: InstanceType<MC>) => void): Promise<InstanceType<MC>>;
    /**
     * Builds a record owned by the query's operation, when present.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Initial attributes.
     * @returns {InstanceType<MC>} - Built record.
     */
    build(attributes?: Record<string, ReturnType<typeof JSON.parse>>): InstanceType<MC>;
    /**
     * Creates a record owned by the query's operation, when present.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Initial attributes.
     * @returns {Promise<InstanceType<MC>>} - Created record.
     */
    create(attributes?: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<MC>>;
    /**
     * Runs first.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the first.
     */
    first(): Promise<InstanceType<MC> | null>;
    /**
     * Runs last.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the last.
     */
    last(): Promise<InstanceType<MC> | null>;
    /**
     * Runs preload.
     * @param {import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} data - Data payload.
     * @returns {this} - The preload.
     */
    preload(data: import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>): this;
    /**
     * Loads query results into model instances.
     * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
     */
    load(): Promise<Array<InstanceType<MC>>>;
    /**
     * Converts query results to array of model instances
     * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
     */
    toArray(): Promise<Array<InstanceType<MC>>>;
    /**
     * Plucks one or more columns directly from the database without instantiating models.
     * @param {...string|string[]} columns - Column names.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Resolves with the pluck.
     */
    pluck(...columns: (string | string[])[]): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs where.
     * @param {import("./index.js").WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    where(where: import("./index.js").WhereArgumentType): this;
    /**
     * Runs ransack.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
     * @returns {this} - Query with Ransack filters and sort applied.
     */
    ransack(params: Record<string, ReturnType<typeof JSON.parse>>): this;
    /**
     * Runs where not.
     * @param {import("./index.js").WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    whereNot(where: import("./index.js").WhereArgumentType): this;
    /**
     * Runs query log name.
     * @param {string} operation - Query operation.
     * @returns {string} - Query log name.
     */
    queryLogName(operation: string): string;
    /**
     * Declares this query as a sync scope on the current sync client.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Declared scope and pull result.
     */
    sync(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Deactivates this query's sync scope on the current sync client.
     * @returns {Promise<void>} - Resolves when the scope is deactivated.
     */
    unsync(): Promise<void>;
}
//# sourceMappingURL=model-class-query.d.ts.map