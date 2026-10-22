// @ts-check
import { incorporate } from "incorporator";
import * as inflection from "inflection";
import { isPlainObject } from "is-plain-object";
import { currentSyncClient } from "../../sync/sync-client-registry.js";
import Logger from "../../logger.js";
import Preloader from "./preloader.js";
import { normalizeQueryDataSpec, runQueryData } from "./query-data.js";
import { normalizeWithCount, runWithCount } from "./with-count.js";
import DatabaseQuery from "./index.js";
import JoinObject from "./join-object.js";
import JoinPlain from "./join-plain.js";
import JoinTracker from "./join-tracker.js";
import RecordNotFoundError from "../record/record-not-found-error.js";
import { normalizeRansackGroup, parseRansackSort } from "../../utils/ransack.js";
import { isModelScopeDescriptor } from "../../utils/model-scope.js";
import { modelPrimaryKeyConditions, scalarModelPrimaryKey } from "../../utils/model-primary-key.js";
import WhereCombinator from "./where-combinator.js";
import WhereModelClassHash from "./where-model-class-hash.js";
import WhereNot from "./where-not.js";
import JoinsParser from "../query-parser/joins-parser.js";
import WhereParser from "../query-parser/where-parser.js";
/**
 * Defines this typedef.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 * @typedef {import("./index.js").QueryArgsType & {modelClass: MC, joinBasePath?: string[], joinTracker?: import("./join-tracker.js").default, forceQualifyBaseTable?: boolean, withCount?: import("./with-count.js").WithCountEntry[], queryData?: import("./query-data.js").QueryDataEntry[], operation?: import("../operation.js").default}} ModelClassQueryArgsType
 */
/**
 * Runs unquote sql identifier.
 * @param {string} value - Potentially quoted SQL identifier.
 * @returns {string} - Unquoted identifier.
 */
function unquoteSqlIdentifier(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && ((trimmed.startsWith("`") && trimmed.endsWith("`")) || (trimmed.startsWith("\"") && trimmed.endsWith("\"")))) {
        return trimmed.slice(1, -1);
    }
    if (trimmed.length >= 2 && trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
/**
 * Runs parse from plain table reference.
 * @param {string} fromPlain - FROM clause source.
 * @returns {string | null} - Parsed table reference or null when unsupported.
 */
function parseFromPlainTableReference(fromPlain) {
    const trimmed = fromPlain.trim();
    if (trimmed.length < 1)
        return null;
    const aliasMatch = trimmed.match(/(?:^|\s)(?:AS\s+)?([`"]?[a-zA-Z_][a-zA-Z0-9_]*[`"]?|\[[a-zA-Z_][a-zA-Z0-9_]*\])\s*$/i);
    if (!aliasMatch || !aliasMatch[1])
        return null;
    return unquoteSqlIdentifier(aliasMatch[1]);
}
/**
 * Runs normalize scope path.
 * @param {string | string[]} path - Scope path input.
 * @returns {string[]} - Normalized path.
 */
function normalizeScopePath(path) {
    if (typeof path === "string") {
        if (path.length < 1)
            throw new Error("Scope path strings must be non-empty");
        return [path];
    }
    if (!Array.isArray(path)) {
        throw new Error(`Invalid scope path type: ${typeof path}`);
    }
    for (const entry of path) {
        if (typeof entry !== "string" || entry.length < 1) {
            throw new Error("Scope path entries must be non-empty strings");
        }
    }
    return [...path];
}
/**
 * Narrows a shared model-scope descriptor to the backend model class required by ModelClassQuery.
 * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Shared scope descriptor.
 * @returns {typeof import("../record/index.js").default} - Backend scope owner.
 */
function backendScopeModelClass(scopeDescriptor) {
    const modelClass = scopeDescriptor.modelClass;
    if (!("canonicalRecordMetadataModelClass" in modelClass)) {
        throw new Error("A frontend-model scope cannot be applied to a database record query");
    }
    // The runtime member check above narrows the shared frontend/backend descriptor boundary.
    return /** @type {typeof import("../record/index.js").default} */ (modelClass);
}
/**
 * Deep-copies a preload select map (keyed by model name with attribute arrays)
 * so a cloned query's selections can be mutated without affecting the original.
 * @param {Record<string, string[]>} map - Preload select map to copy.
 * @returns {Record<string, string[]>} - A copy with independent arrays.
 */
function clonePreloadSelectMap(map) {
    /**
     * Result.
     * @type {Record<string, string[]>} */
    const result = {};
    for (const [modelName, attributes] of Object.entries(map)) {
        result[modelName] = [...attributes];
    }
    return result;
}
/**
 * Runs normalize preload record.
 * @param {import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} preload - Preload data in shorthand or nested form.
 * @returns {import("./index.js").NestedPreloadRecord} - Normalized preload record.
 */
function normalizePreloadRecord(preload) {
    if (!preload)
        return {};
    if (typeof preload == "string") {
        return { [preload]: true };
    }
    if (Array.isArray(preload)) {
        /**
         * Result.
         * @type {import("./index.js").NestedPreloadRecord} */
        const result = {};
        for (const entry of preload) {
            if (typeof entry == "string") {
                result[entry] = true;
                continue;
            }
            if (isPlainObject(entry)) {
                incorporate(result, normalizePreloadRecord(entry));
                continue;
            }
            throw new Error(`Invalid preload entry type: ${typeof entry}`);
        }
        return result;
    }
    if (!isPlainObject(preload)) {
        throw new Error(`Invalid preload type: ${typeof preload}`);
    }
    /**
     * Result.
     * @type {import("./index.js").NestedPreloadRecord} */
    const result = {};
    for (const [key, value] of Object.entries(preload)) {
        if (value === true || value === false) {
            result[key] = value;
            continue;
        }
        if (typeof value == "string" || Array.isArray(value) || isPlainObject(value)) {
            result[key] = normalizePreloadRecord(value);
            continue;
        }
        throw new Error(`Invalid preload value for ${key}: ${typeof value}`);
    }
    return result;
}
/**
 * Defines this typedef.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
/**
 * A generic query over some model type.
 * @template {typeof import("../record/index.js").default} [MC=typeof import("../record/index.js").default]
 */
export default class VelociousDatabaseQueryModelClassQuery extends DatabaseQuery {
    /**
     * Runs constructor.
     * @param {ModelClassQueryArgsType<MC>} args - Query constructor arguments.
     */
    constructor(args) {
        const { modelClass } = args;
        if (!modelClass)
            throw new Error(`No modelClass given in ${Object.keys(args).join(", ")}`);
        super(args);
        this.logger = new Logger(this);
        /**
         * Narrows the runtime value to the documented type.
         * @type {MC} */
        this.modelClass = modelClass;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string[]} */
        this._joinBasePath = args.joinBasePath || [];
        this._joinTracker = args.joinTracker || new JoinTracker({ modelClass: this.modelClass });
        this._forceQualifyBaseTable = Boolean(args.forceQualifyBaseTable);
        this._operation = args.operation;
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("./with-count.js").WithCountEntry[]} */
        this._withCount = args.withCount ? [...args.withCount] : [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("./query-data.js").QueryDataEntry[]} */
        this._queryData = args.queryData ? [...args.queryData] : [];
    }
    /**
     * Runs clone.
     * @returns {this} - The clone.
     */
    clone() {
        const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (new VelociousDatabaseQueryModelClassQuery({
            driver: this._driverFn,
            froms: [...this._froms],
            handler: this.handler.clone(),
            groups: [...this._groups],
            joins: [...this._joins],
            limit: this._limit,
            modelClass: this.modelClass,
            offset: this._offset,
            orders: [...this._orders],
            page: this._page,
            perPage: this._perPage,
            preload: { ...this._preload },
            preloadSelects: clonePreloadSelectMap(this._preloadSelects),
            preloadSelectsExtra: clonePreloadSelectMap(this._preloadSelectsExtra),
            distinct: this._distinct,
            selects: [...this._selects],
            signal: this._signal,
            wheres: [...this._wheres],
            joinBasePath: [...this._joinBasePath],
            joinTracker: this._joinTracker.clone(),
            forceQualifyBaseTable: this._forceQualifyBaseTable,
            withCount: [...this._withCount],
            queryData: [...this._queryData],
            operation: this._operation
        }));
        // @ts-expect-error
        return newQuery;
    }
    /**
     * Tell the query to attach one or more association counts onto every
     * loaded record. The counts land as regular attributes on each record;
     * read them with `model.readAttribute("<name>Count")`.
     * @param {import("./with-count.js").WithCountSpec} spec - Count spec in shorthand or nested form.
     * @returns {this} - This query, for chaining.
     */
    withCount(spec) {
        for (const entry of normalizeWithCount(spec)) {
            this._withCount.push(entry);
        }
        return this;
    }
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
    queryData(spec) {
        for (const entry of normalizeQueryDataSpec(spec)) {
            this._queryData.push(entry);
        }
        return this;
    }
    /**
     * Return the table reference (alias or table name) registered for the
     * given relationship chain, relative to the query's current join base
     * path. Convenience wrapper around `getTableReferenceForJoin` for use
     * inside `queryData` callbacks where the writer's intent reads more
     * naturally as "give me the table name for 'tasks'".
     * @param {...string} path - Relationship path segments.
     * @returns {string} - Unquoted table reference.
     */
    tableNameFor(...path) {
        return this.getTableReferenceForJoin(...path);
    }
    /**
     * Runs count.
     * @returns {Promise<number>} - Resolves with the count.
     */
    async count() {
        await this._ensureInitialized();
        // A model without a single primary-key column — setPrimaryKey(null) or a composite
        // setPrimaryKey([...]) on legacy tables — has no column COUNT can reference (an array primary key
        // cannot be quoted as a single COUNT(column), and primaryKey() falls back to "id" for the no-pk
        // case, so hasPrimaryKey() detects that one).
        const primaryKey = this.getModelClass().primaryKey();
        const hasSingleColumnPrimaryKey = this.getModelClass().hasPrimaryKey() && !Array.isArray(primaryKey);
        // Pagination, or an ungrouped query on a model with no single primary-key column, counts via the
        // subquery form. It references no primary-key column and preserves DISTINCT over joins — which a
        // bare COUNT(*) would not (it would count joined duplicate rows instead of distinct root rows).
        // A grouped query stays on the per-group flow below, because the subquery form would count one
        // row per group instead of summing each group's row count.
        if (this._limit !== null || this._offset !== null || (!hasSingleColumnPrimaryKey && this._groups.length == 0)) {
            return await this.paginatedCount();
        }
        if (!hasSingleColumnPrimaryKey && this._distinct) {
            throw new Error(`Can't count a grouped distinct query on ${this.getModelClass().name} because it has no single primary-key column to count distinct values of`);
        }
        const distinctPrefix = this._distinct ? "DISTINCT " : "";
        const countExpression = hasSingleColumnPrimaryKey
            ? `${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(/** @type {string} */ (primaryKey))}`
            : "*";
        let sql = `COUNT(${distinctPrefix}${countExpression})`;
        if (this.driver.getType() == "pgsql")
            sql += "::int";
        sql += " AS count";
        // Clone query and execute count
        const countQuery = this.clone();
        countQuery._distinct = false;
        countQuery._selects = [];
        countQuery.select(sql);
        const results = /** @type {{count: number}[]} */ (await countQuery._executeQuery({
            logName: countQuery.queryLogName("Count")
        }));
        // The query isn't grouped and a single result has been given
        if (results.length == 1) {
            return results[0].count;
        }
        // The query may be grouped and a lot of different counts a given
        let countResult = 0;
        for (const result of results) {
            if (!("count" in result)) {
                throw new Error("Invalid count result");
            }
            countResult += result.count;
        }
        return countResult;
    }
    /**
     * Runs paginated count.
     * @returns {Promise<number>} - Resolves with the count after pagination is applied.
     */
    async paginatedCount() {
        const countQuery = this.clone();
        const countSql = this.driver.getType() == "pgsql" ? "COUNT(*)::int" : "COUNT(*)";
        const sql = [
            `SELECT ${countSql} AS ${this.driver.quoteColumn("count")}`,
            `FROM (${countQuery.toSql()}) AS ${this.driver.quoteTable("paginated_count_rows")}`
        ].join(" ");
        const results = /** @type {{count: number}[]} */ (await this.driver.query(sql, { logName: this.queryLogName("Count"), signal: this._signal }));
        if (results.length != 1 || !("count" in results[0])) {
            throw new Error("Invalid count result");
        }
        return results[0].count;
    }
    /**
     * Runs select.
     * @param {import("./index.js").SelectArgumentType} select - Select.
     * @returns {this} - The select.
     */
    select(select) {
        if (Array.isArray(select)) {
            for (const selectEntry of select) {
                this.select(selectEntry);
            }
            return this;
        }
        if (typeof select === "string") {
            const trimmedSelect = select.trim();
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedSelect)) {
                const modelClass = this.getModelClass();
                const attributeMap = modelClass.getAttributeNameToColumnNameMap();
                const columnName = attributeMap[trimmedSelect] || trimmedSelect;
                const tableReference = this.rootTableReference();
                const qualifiedColumn = `${this.driver.quoteTable(tableReference)}.${this.driver.quoteColumn(columnName)}`;
                return super.select(qualifiedColumn);
            }
        }
        // Object form keyed by target model name, e.g. `.select({Account: ["id"]})`.
        // These limit the attributes loaded for preloaded relationship targets
        // rather than the root query's SELECT clause.
        if (isPlainObject(select)) {
            this._mergePreloadSelect(this._preloadSelects, select);
            return this;
        }
        return super.select(select);
    }
    /**
     * Loads the default columns plus the given extra selects for preloaded
     * relationship targets, keyed by target model name, e.g.
     * `.selectsExtra({Account: ["(SELECT count(*) FROM projects) AS projects_count"]})`.
     * Unlike `select({...})`, which narrows to only the listed columns, this keeps
     * the default `SELECT *` columns and adds the extras on top.
     * @param {Record<string, string | string[]>} select - Extra selects keyed by target model name.
     * @returns {this} - This query, for chaining.
     */
    selectsExtra(select) {
        this._mergePreloadSelect(this._preloadSelectsExtra, select);
        return this;
    }
    /**
     * Merges an object-form preload select (keyed by target model name) into the
     * given target map, de-duplicating attribute/expression entries.
     * @param {Record<string, string[]>} target - Map to merge into.
     * @param {Record<string, string | string[]>} select - Object-form select.
     * @returns {void} - No return value.
     */
    _mergePreloadSelect(target, select) {
        for (const [modelName, attributes] of Object.entries(select)) {
            const normalizedAttributes = Array.isArray(attributes) ? attributes : [attributes];
            if (!target[modelName])
                target[modelName] = [];
            for (const attribute of normalizedAttributes) {
                if (!target[modelName].includes(attribute))
                    target[modelName].push(attribute);
            }
        }
    }
    /**
     * Runs root table reference.
     * @returns {string} - Root table reference for query select qualification.
     */
    rootTableReference() {
        const froms = this.getFroms();
        const lastFrom = froms[froms.length - 1];
        if (lastFrom && typeof /** @type {ReturnType<typeof JSON.parse>} */ (lastFrom).tableName === "string") {
            return /** @type {ReturnType<typeof JSON.parse>} */ (lastFrom).tableName;
        }
        if (lastFrom && typeof /** @type {ReturnType<typeof JSON.parse>} */ (lastFrom).plain === "string") {
            const parsedReference = parseFromPlainTableReference(/** @type {ReturnType<typeof JSON.parse>} */ (lastFrom).plain);
            if (parsedReference)
                return parsedReference;
        }
        return this.getTableReferenceForJoin();
    }
    /**
     * Runs get model class.
     * @returns {MC} - The model class.
     */
    getModelClass() {
        if (!this.modelClass)
            throw new Error("modelClass not set");
        return this.modelClass;
    }
    /**
     * Ensures the model table metadata is loaded before an operation that needs it.
     * Query builders stay synchronous and metadata-free; execution initializes lazily.
     * @returns {Promise<void>} - Resolves when the model is initialized.
     */
    async _ensureInitialized() {
        await this.getModelClass().ensureInitialized();
    }
    /**
     * Binds a relationship target to this query's physical database generation.
     * @param {typeof import("../record/index.js").default} modelClass - Canonical relationship target.
     * @returns {typeof import("../record/index.js").default} - Query-bound relationship target.
     */
    bindModelClass(modelClass) {
        return this.getModelClass().bindRecordMetadataModelClass(modelClass);
    }
    /**
     * Runs get join base path.
     * @returns {string[]} - The join base path.
     */
    getJoinBasePath() {
        return this._joinBasePath;
    }
    /**
     * Runs get join tracker.
     * @returns {import("./join-tracker.js").default} - The join tracker.
     */
    getJoinTracker() {
        return this._joinTracker;
    }
    /**
     * Runs get force qualify base table.
     * @returns {boolean} - Whether to qualify base table.
     */
    getForceQualifyBaseTable() {
        return this._forceQualifyBaseTable;
    }
    /**
     * Runs set join base path.
     * @param {string[]} joinBasePath - Join base path.
     * @returns {this} - The query with updated base path.
     */
    setJoinBasePath(joinBasePath) {
        this._joinBasePath = joinBasePath;
        return this;
    }
    /**
     * Runs with join path.
     * @param {string[]} joinBasePath - Join base path.
     * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped query.
     */
    withJoinPath(joinBasePath) {
        const scopedQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone());
        scopedQuery._joinBasePath = joinBasePath;
        scopedQuery._joinTracker = this._joinTracker;
        return scopedQuery;
    }
    /**
     * Runs resolve table name for join path.
     * @param {string[]} path - Join path.
     * @returns {string} - Table name for path.
     */
    _resolveTableNameForJoinPath(path) {
        return this._resolveModelClassForJoinPath(path).tableName();
    }
    /**
     * Runs resolve model class for join path.
     * @param {string[]} path - Join path.
     * @returns {typeof import("../record/index.js").default} - Target model class.
     */
    _resolveModelClassForJoinPath(path) {
        let modelClass = this._joinTracker.getRootModelClass();
        for (const relationshipName of path) {
            const relationship = modelClass.getRelationshipByName(relationshipName);
            const targetModelClass = relationship.getTargetModelClass();
            if (!targetModelClass) {
                throw new Error(`No target model class for ${modelClass.name}#${relationshipName}`);
            }
            modelClass = this.bindModelClass(targetModelClass);
        }
        return modelClass;
    }
    /**
     * Runs register join path.
     * @param {string[]} path - Join path.
     * @returns {{tableName: string, alias: string | undefined}} - The entry.
     */
    _registerJoinPath(path) {
        const tableName = this._resolveTableNameForJoinPath(path);
        return this._joinTracker.registerPath(path, tableName);
    }
    /**
     * Runs get join table reference.
     * @param {string[]} path - Join path.
     * @returns {string} - Unquoted table reference (alias or table name).
     */
    getJoinTableReference(path) {
        const entry = this._joinTracker.getEntry(path) || this._registerJoinPath(path);
        return entry.alias || entry.tableName;
    }
    /**
     * Runs get table reference for join.
     * @param {...string} path - Join path segments.
     * @returns {string} - Unquoted table reference (alias or table name).
     */
    getTableReferenceForJoin(...path) {
        const fullPath = this._joinBasePath.concat(path);
        return this.getJoinTableReference(fullPath);
    }
    /**
     * Runs get table for join.
     * @param {...string} path - Join path segments.
     * @returns {string} - Quoted table name for join path.
     */
    getTableForJoin(...path) {
        return this.driver.quoteTable(this.getTableReferenceForJoin(...path));
    }
    /**
     * Runs scope.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor | string | string[]} pathOrScopeDescriptor - Scope descriptor or join path.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} [maybeScopeDescriptor] - Scope descriptor when path is given.
     * @returns {this} - Scoped query.
     */
    scope(pathOrScopeDescriptor, maybeScopeDescriptor) {
        if (isModelScopeDescriptor(pathOrScopeDescriptor) && !maybeScopeDescriptor) {
            return this._applyRootScope(pathOrScopeDescriptor);
        }
        if (!maybeScopeDescriptor) {
            throw new Error("scope(path, descriptor) requires a scope descriptor");
        }
        return this._applyJoinPathScope({
            joinPath: normalizeScopePath(/** @type {string | string[]} */ (pathOrScopeDescriptor)),
            scopeDescriptor: maybeScopeDescriptor
        });
    }
    /**
     * Runs apply root scope.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    _applyRootScope(scopeDescriptor) {
        if (!isModelScopeDescriptor(scopeDescriptor)) {
            throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)");
        }
        const scopeModelClass = backendScopeModelClass(scopeDescriptor);
        if (scopeModelClass.canonicalRecordMetadataModelClass() !== this.getModelClass().canonicalRecordMetadataModelClass()) {
            throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to ${this.getModelClass().name} query`);
        }
        const scopedQuery = /** @type {this | void} */ (scopeDescriptor.callback({
            driver: this.driver,
            modelClass: this.getModelClass(),
            query: this,
            table: this.rootTableReference()
        }, ...scopeDescriptor.scopeArgs));
        return scopedQuery || this;
    }
    /**
     * Runs apply join path scope.
     * @param {object} args - Join-path scope options.
     * @param {string[]} args.joinPath - Join path relative to the current query.
     * @param {import("../../utils/model-scope.js").ModelScopeDescriptor} args.scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    _applyJoinPathScope({ joinPath, scopeDescriptor }) {
        if (!isModelScopeDescriptor(scopeDescriptor)) {
            throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)");
        }
        const fullJoinPath = this.getJoinBasePath().concat(joinPath);
        const targetModelClass = this._resolveModelClassForJoinPath(fullJoinPath);
        const scopeModelClass = backendScopeModelClass(scopeDescriptor);
        if (scopeModelClass.canonicalRecordMetadataModelClass() !== targetModelClass.canonicalRecordMetadataModelClass()) {
            throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to join path ${fullJoinPath.join(".")} (${targetModelClass.name})`);
        }
        const scopedQuery = this.buildJoinScopeQuery(targetModelClass, fullJoinPath);
        const originalJoinCount = scopedQuery._joins.length;
        const originalWhereCount = scopedQuery._wheres.length;
        const appliedQuery = /** @type {typeof scopedQuery | void} */ (scopeDescriptor.callback({
            driver: scopedQuery.driver,
            modelClass: targetModelClass,
            path: [...fullJoinPath],
            query: scopedQuery,
            table: scopedQuery.getTableReferenceForJoin()
        }, ...scopeDescriptor.scopeArgs)) || scopedQuery;
        if (appliedQuery.getFroms().length !== scopedQuery.getFroms().length ||
            appliedQuery.getGroups().length !== scopedQuery.getGroups().length ||
            appliedQuery.getSelects().length !== scopedQuery.getSelects().length ||
            appliedQuery._orders.length !== scopedQuery._orders.length ||
            appliedQuery._limit !== scopedQuery._limit ||
            appliedQuery._offset !== scopedQuery._offset ||
            appliedQuery._page !== scopedQuery._page ||
            appliedQuery._perPage !== scopedQuery._perPage ||
            appliedQuery._distinct !== scopedQuery._distinct ||
            Object.keys(appliedQuery._preload).length !== Object.keys(scopedQuery._preload).length) {
            throw new Error("Joined-path scopes may only add where(...) and joins(...) clauses");
        }
        if (appliedQuery._joins.length > originalJoinCount) {
            for (const join of appliedQuery._joins.slice(originalJoinCount)) {
                if (join instanceof JoinObject) {
                    this._joins.push(new JoinObject(join.object, fullJoinPath));
                }
                else if (join instanceof JoinPlain) {
                    this._joins.push(join);
                }
                else {
                    this._joins.push(join);
                }
            }
        }
        if (appliedQuery._wheres.length > originalWhereCount) {
            this._wheres.push(...appliedQuery._wheres.slice(originalWhereCount));
        }
        return this;
    }
    /**
     * Runs build join scope query.
     * @param {typeof import("../record/index.js").default} targetModelClass - Target model class.
     * @param {string[]} joinPath - Join path.
     * @returns {VelociousDatabaseQueryModelClassQuery<MC>} - The scoped join query.
     */
    buildJoinScopeQuery(targetModelClass, joinPath) {
        const scopedQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this._operation
            ? this._operation.forModel(targetModelClass)
            : targetModelClass._newQuery());
        scopedQuery._joinTracker = this._joinTracker;
        scopedQuery._joinBasePath = joinPath;
        scopedQuery._forceQualifyBaseTable = true;
        return scopedQuery;
    }
    /**
     * Runs destroy all.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async destroyAll() {
        const records = await this.toArray();
        for (const record of records) {
            await record.destroy();
        }
    }
    /**
     * Executes a bulk UPDATE on all rows matching the query's WHERE
     * clause. Bypasses model lifecycle callbacks — use this for
     * efficient batch updates where per-row hooks aren't needed.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - camelCase attribute names → values.
     * @returns {Promise<void>} - Resolves when the update completes.
     */
    async updateAll(data) {
        await this._ensureInitialized();
        const driver = this.driver;
        const tableName = this.getModelClass().tableName();
        const entries = Object.entries(data);
        if (entries.length === 0)
            return;
        const setCols = entries.map(([key, value]) => {
            const columnName = inflection.underscore(key);
            const quoted = value === null ? "NULL" : driver.quote(value);
            return `${driver.quoteColumn(columnName)} = ${quoted}`;
        }).join(", ");
        const joinsSql = new JoinsParser({ pretty: false, query: this }).toSql();
        const whereSql = new WhereParser({ pretty: false, query: this }).toSql();
        let sql;
        if (joinsSql.length > 0) {
            // Use a subquery for cross-driver compatibility (SQLite
            // doesn't support UPDATE ... JOIN).
            const primaryKey = scalarModelPrimaryKey(this.getModelClass().primaryKey(), `${this.getModelClass().name}.updateAll() with joins`);
            const pk = driver.quoteColumn(primaryKey);
            const qt = driver.quoteTable(tableName);
            sql = `UPDATE ${qt} SET ${setCols} WHERE ${pk} IN (SELECT ${qt}.${pk} FROM ${qt}${joinsSql}${whereSql})`;
        }
        else {
            sql = `UPDATE ${driver.quoteTable(tableName)} SET ${setCols}${whereSql}`;
        }
        await driver.query(sql, { logName: this.queryLogName("Update All"), signal: this._signal });
    }
    /**
     * Runs find.
     * @param {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} recordId - Record id.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
     */
    async find(recordId) {
        await this._ensureInitialized();
        /**
         * Conditions.
         * @type {{[key: string]: number | string}} */
        const conditions = {};
        Object.assign(conditions, modelPrimaryKeyConditions(this.getModelClass().primaryKey(), recordId));
        const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone());
        newQuery.where(conditions);
        const record = (await newQuery.first());
        if (!record) {
            throw new RecordNotFoundError(`Couldn't find ${this.getModelClass().name} with '${this.getModelClass().primaryKey()}'=${JSON.stringify(recordId)}`);
        }
        return record;
    }
    /**
     * Runs find by.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
     */
    async findBy(conditions) {
        await this._ensureInitialized();
        const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone());
        newQuery.where(conditions);
        return await newQuery.first();
    }
    /**
     * Runs find or create by.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
     */
    async findOrCreateBy(conditions, callback) {
        const record = await this.findOrInitializeBy(conditions, callback);
        if (record.isNewRecord()) {
            await record.save();
        }
        return record;
    }
    /**
     * Runs find by or fail.
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
     */
    async findByOrFail(conditions) {
        const record = await this.findBy(conditions);
        if (!record) {
            throw new Error("Record not found");
        }
        return record;
    }
    /**
     * Runs find or initialize by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
     */
    async findOrInitializeBy(conditions, callback) {
        const record = await this.findBy(conditions);
        if (record)
            return record;
        const newRecord = this.build(conditions);
        if (callback) {
            callback(newRecord);
        }
        return newRecord;
    }
    /**
     * Builds a record owned by the query's operation, when present.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Initial attributes.
     * @returns {InstanceType<MC>} - Built record.
     */
    build(attributes = {}) {
        const ModelClass = this.getModelClass();
        const record = /** @type {InstanceType<MC>} */ (new ModelClass(attributes));
        if (this._operation)
            this._operation.bindRecord(record);
        return record;
    }
    /**
     * Creates a record owned by the query's operation, when present.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [attributes] - Initial attributes.
     * @returns {Promise<InstanceType<MC>>} - Created record.
     */
    async create(attributes = {}) {
        await this._ensureInitialized();
        const record = this.build(attributes);
        await record.save();
        return record;
    }
    /**
     * Runs first.
     *
     * An explicitly set order is preserved; the deterministic identity order is
     * only applied as a fallback when no order was set, so `LIMIT 1` never
     * returns an arbitrary row.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the first.
     */
    async first() {
        const newQuery = this.clone().limit(1);
        if (newQuery.getOrders().length == 0)
            newQuery.reorder(this._defaultIdentityOrder("ASC"));
        const results = await newQuery.toArray();
        return results[0] || null;
    }
    /**
     * Runs last.
     *
     * An explicitly set order is preserved and read from its end; the
     * deterministic identity order is only applied as a fallback when no order
     * was set. The clone shares its order instances with the source query, so
     * the explicit orders are replaced by independent reversed copies instead
     * of mutating the shared ones.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the last.
     */
    async last() {
        const newQuery = this.clone().limit(1);
        if (newQuery.getOrders().length == 0) {
            newQuery.reorder(this._defaultIdentityOrder("DESC"));
        }
        else {
            const orders = newQuery.getOrders();
            for (let i = 0; i < orders.length; i += 1)
                orders[i] = orders[i].reversedCopy();
        }
        const results = await newQuery.toArray();
        return results[0] || null;
    }
    /**
     * Builds the deterministic default order for the model identity.
     * @param {"ASC" | "DESC"} direction - Sort direction.
     * @returns {string} - SQL order expression.
     */
    _defaultIdentityOrder(direction) {
        const ModelClass = this.getModelClass();
        const primaryKey = ModelClass.primaryKey();
        const orderableColumns = Array.isArray(primaryKey) ? primaryKey : [ModelClass.orderableColumn()];
        return orderableColumns
            .map((column) => `${this.driver.quoteTable(ModelClass.tableName())}.${this.driver.quoteColumn(column)} ${direction}`)
            .join(", ");
    }
    /**
     * Runs preload.
     * @param {import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} data - Data payload.
     * @returns {this} - The preload.
     */
    preload(data) {
        const normalizedPreload = normalizePreloadRecord(data);
        incorporate(this._preload, normalizedPreload);
        return this;
    }
    /**
     * Loads query results into model instances.
     * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
     */
    async load() {
        await this._ensureInitialized();
        const models = [];
        const results = await this.results();
        const selectedAttributeAliases = new Set();
        for (const select of this.getSelects()) {
            const alias = select.getAlias(this.driver);
            if (alias)
                selectedAttributeAliases.add(alias);
        }
        for (const result of results) {
            const model = this.build();
            model.loadExistingRecord(result, selectedAttributeAliases);
            models.push(model);
        }
        // Share a single cohort reference across every sibling record so that
        // auto-preload can batch lazy relationship access later.
        for (const model of models) {
            model._loadCohort = models;
        }
        if (Object.keys(this._preload).length > 0 && models.length > 0) {
            const preloader = new Preloader({
                modelClass: this.modelClass,
                models,
                preload: this._preload,
                preloadSelects: this._preloadSelects,
                preloadSelectsExtra: this._preloadSelectsExtra
            });
            await preloader.run();
        }
        if (this._withCount.length > 0 && models.length > 0) {
            await runWithCount({
                entries: this._withCount,
                modelClass: this.modelClass,
                models
            });
        }
        if (this._queryData.length > 0 && models.length > 0) {
            await runQueryData({
                entries: this._queryData,
                rootModelClass: this.modelClass,
                rootModels: models
            });
        }
        return models;
    }
    /**
     * Converts query results to array of model instances
     * @returns {Promise<Array<InstanceType<MC>>>} - Resolves with the array.
     */
    async toArray() {
        return await this.load();
    }
    /**
     * Plucks one or more columns directly from the database without instantiating models.
     * @param {...string|string[]} columns - Column names.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Resolves with the pluck.
     */
    async pluck(...columns) {
        await this._ensureInitialized();
        const flatColumns = columns.flat();
        if (flatColumns.length === 0)
            throw new Error("No columns given to pluck");
        const modelClass = this.getModelClass();
        const tableName = modelClass.tableName();
        const attributeMap = modelClass.getAttributeNameToColumnNameMap();
        const columnNames = flatColumns.map((column) => attributeMap[column] || column);
        const query = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone());
        query._preload = {};
        query._selects = [];
        columnNames.forEach((columnName) => {
            const selectSql = `${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(columnName)}`;
            query.select(selectSql);
        });
        const rows = await query._executeQuery({ logName: query.queryLogName("Pluck") });
        if (columnNames.length === 1) {
            const [columnName] = columnNames;
            return rows.map((row) => /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)[columnName]);
        }
        return rows.map((row) => {
            const rowHash = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row);
            return columnNames.map((columnName) => rowHash[columnName]);
        });
    }
    /**
     * Runs where.
     * @param {import("./index.js").WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    where(where) {
        if (typeof where == "string") {
            return super.where(where);
        }
        if (isPlainObject(where)) {
            const { resolvedHash, fallbackHash } = splitWhereHash({ hash: where, modelClass: this.getModelClass() });
            const joinObject = buildJoinObjectFromWhereHash({ hash: where, modelClass: this.getModelClass() });
            if (Object.keys(joinObject).length > 0) {
                this.joins(joinObject);
            }
            if (Object.keys(resolvedHash).length > 0) {
                const qualifyBaseTable = this.getForceQualifyBaseTable() || Object.keys(joinObject).length > 0;
                this._wheres.push(new WhereModelClassHash({
                    hash: resolvedHash,
                    modelClass: this.getModelClass(),
                    qualifyBaseTable,
                    query: this
                }));
            }
            if (Object.keys(fallbackHash).length > 0) {
                super.where(fallbackHash);
            }
            return this;
        }
        throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`);
    }
    /**
     * Runs ransack.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
     * @returns {this} - Query with Ransack filters and sort applied.
     */
    ransack(params) {
        const { s, ...filterParams } = params;
        const group = normalizeRansackGroup(this.getModelClass(), filterParams);
        applyRansackGroup({ group, query: this });
        if (typeof s === "string" && s.trim().length > 0) {
            const sorts = parseRansackSort(this.getModelClass(), s);
            for (const sortDef of sorts) {
                this.order({ column: sortDef.attribute, direction: sortDef.direction });
            }
        }
        return this;
    }
    /**
     * Runs where not.
     * @param {import("./index.js").WhereArgumentType} where - Where.
     * @returns {this} This query instance
     */
    whereNot(where) {
        if (typeof where == "string") {
            return super.whereNot(where);
        }
        if (isPlainObject(where)) {
            const { resolvedHash, fallbackHash } = splitWhereHash({ hash: where, modelClass: this.getModelClass() });
            const joinObject = buildJoinObjectFromWhereHash({ hash: where, modelClass: this.getModelClass() });
            if (Object.keys(joinObject).length > 0) {
                this.joins(joinObject);
            }
            if (Object.keys(resolvedHash).length > 0) {
                const qualifyBaseTable = this.getForceQualifyBaseTable() || Object.keys(joinObject).length > 0;
                this._wheres.push(new WhereNot(new WhereModelClassHash({
                    hash: resolvedHash,
                    modelClass: this.getModelClass(),
                    qualifyBaseTable,
                    query: this
                })));
            }
            if (Object.keys(fallbackHash).length > 0) {
                super.whereNot(fallbackHash);
            }
            return this;
        }
        throw new Error(`Invalid type of where: ${typeof where} (${where.constructor.name})`);
    }
    /**
     * Runs query log name.
     * @param {string} operation - Query operation.
     * @returns {string} - Query log name.
     */
    queryLogName(operation) {
        return `${this.getModelClass().name} ${operation}`;
    }
    /**
     * Declares this query as a sync scope on the current sync client.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Declared scope and pull result.
     */
    async sync() {
        return await currentSyncClient().sync(this);
    }
    /**
     * Deactivates this query's sync scope on the current sync client.
     * @returns {Promise<void>} - Resolves when the scope is deactivated.
     */
    async unsync() {
        await currentSyncClient().unsync(this);
    }
}
/**
 * Runs apply ransack group.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackGroup} args.group - Normalized Ransack group.
 * @param {import("./model-class-query.js").default<ReturnType<typeof JSON.parse>>} args.query - Query instance.
 * @returns {void}
 */
function applyRansackGroup({ group, query }) {
    const where = buildRansackGroupWhere({ group, query });
    if (where) {
        query._wheres.push(where);
    }
}
/**
 * Runs build ransack group where.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackGroup} args.group - Normalized Ransack group.
 * @param {import("./model-class-query.js").default<ReturnType<typeof JSON.parse>>} args.query - Query instance.
 * @returns {import("./where-base.js").default | null} - Combined where clause.
 */
function buildRansackGroupWhere({ group, query }) {
    /**
     * Wheres.
     * @type {import("./where-base.js").default[]} */
    const wheres = [];
    for (const condition of group.conditions) {
        const where = buildRansackConditionWhere({ condition, query });
        if (where)
            wheres.push(where);
    }
    for (const grouping of group.groupings) {
        const where = buildRansackGroupWhere({ group: grouping, query });
        if (where)
            wheres.push(where);
    }
    if (wheres.length < 1)
        return null;
    if (wheres.length === 1)
        return wheres[0];
    return new WhereCombinator({
        combinator: group.combinator,
        query,
        wheres
    });
}
/**
 * Runs build ransack condition where.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @param {import("./model-class-query.js").default<ReturnType<typeof JSON.parse>>} args.query - Query instance.
 * @returns {import("./where-base.js").default | null} - Condition where clause.
 */
function buildRansackConditionWhere({ condition, query }) {
    /**
     * Wheres.
     * @type {import("./where-base.js").default[]} */
    const wheres = [];
    for (const attribute of condition.attributes) {
        wheres.push(buildRansackAttributeWhere({ attribute, condition, query }));
    }
    if (wheres.length < 1)
        return null;
    if (wheres.length === 1)
        return wheres[0];
    return new WhereCombinator({
        combinator: condition.combinator,
        query,
        wheres
    });
}
/**
 * Runs build ransack attribute where.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackAttribute} args.attribute - Normalized Ransack attribute.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @param {import("./model-class-query.js").default<ReturnType<typeof JSON.parse>>} args.query - Query instance.
 * @returns {import("./where-base.js").default} - Attribute where clause.
 */
function buildRansackAttributeWhere({ attribute, condition, query }) {
    const hash = buildRansackAttributeHash({ attribute, condition });
    const joinObject = buildJoinObjectFromWhereHash({ hash, modelClass: query.getModelClass() });
    if (Object.keys(joinObject).length > 0) {
        query.joins(joinObject);
    }
    const where = new WhereModelClassHash({
        hash,
        modelClass: query.getModelClass(),
        qualifyBaseTable: true,
        query
    });
    if (condition.predicate === "not_eq" || condition.predicate === "not_in") {
        return new WhereNot(where);
    }
    if (condition.predicate === "null" && !condition.value) {
        return new WhereNot(where);
    }
    return where;
}
/**
 * Runs build ransack attribute hash.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackAttribute} args.attribute - Normalized Ransack attribute.
 * @param {import("../../utils/ransack.js").RansackCondition} args.condition - Normalized Ransack condition.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Nested hash suitable for query where nodes.
 */
function buildRansackAttributeHash({ attribute, condition }) {
    if (condition.predicate === "eq" || condition.predicate === "in" || condition.predicate === "not_eq" || condition.predicate === "not_in") {
        return buildNestedRansackHash({ attribute, value: condition.value });
    }
    if (condition.predicate === "null") {
        return buildNestedRansackHash({ attribute, value: null });
    }
    return buildNestedRansackTupleHash({
        attribute,
        operator: ransackTupleOperator(condition.predicate),
        value: ransackTupleValue(condition)
    });
}
/**
 * Runs build nested ransack hash.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackAttribute} args.attribute - Normalized Ransack attribute.
 * @param {ReturnType<typeof JSON.parse>} args.value - Final value.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Nested hash suitable for query where nodes.
 */
function buildNestedRansackHash({ attribute, value }) {
    /**
     * Hash.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let hash = { [attribute.attributeName]: value };
    for (let index = attribute.path.length - 1; index >= 0; index -= 1) {
        hash = { [attribute.path[index]]: hash };
    }
    return hash;
}
/**
 * Runs build nested ransack tuple hash.
 * @param {object} args - Options.
 * @param {import("../../utils/ransack.js").RansackAttribute} args.attribute - Normalized Ransack attribute.
 * @param {"gt" | "gteq" | "lt" | "lteq" | "like"} args.operator - Tuple operator.
 * @param {ReturnType<typeof JSON.parse>} args.value - Final value.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Nested tuple hash suitable for query.where.
 */
function buildNestedRansackTupleHash({ attribute, operator, value }) {
    /**
     * Hash.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let hash = {
        [attribute.attributeName]: [[attribute.attributeName, operator, value]]
    };
    for (let index = attribute.path.length - 1; index >= 0; index -= 1) {
        hash = { [attribute.path[index]]: hash };
    }
    return hash;
}
/**
 * Runs ransack tuple operator.
 * @param {import("../../utils/ransack.js").RansackPredicate} predicate - Ransack predicate.
 * @returns {"gt" | "gteq" | "lt" | "lteq" | "like"} - Query tuple operator.
 */
function ransackTupleOperator(predicate) {
    if (predicate === "gt" || predicate === "gteq" || predicate === "lt" || predicate === "lteq") {
        return predicate;
    }
    return "like";
}
/**
 * Runs ransack tuple value.
 * @param {import("../../utils/ransack.js").RansackCondition} condition - Ransack condition.
 * @returns {ReturnType<typeof JSON.parse>} - Query tuple value.
 */
function ransackTupleValue(condition) {
    if (condition.predicate === "cont")
        return `%${condition.value}%`;
    if (condition.predicate === "start")
        return `${condition.value}%`;
    if (condition.predicate === "end")
        return `%${condition.value}`;
    return condition.value;
}
/**
 * Runs get relationship by name.
 * @param {typeof import("../record/index.js").default} modelClass - Model class.
 * @param {string} relationshipName - Relationship name.
 * @returns {import("../record/relationships/base.js").default | undefined} - The relationship.
 */
function getRelationshipByName(modelClass, relationshipName) {
    return modelClass.getRelationshipsMap()[relationshipName];
}
/**
 * Runs resolve column name.
 * @param {typeof import("../record/index.js").default} modelClass - Model class.
 * @param {string} key - Attribute or column name.
 * @returns {string | undefined} - The resolved column name.
 */
function resolveColumnName(modelClass, key) {
    const attributeMap = modelClass.getAttributeNameToColumnNameMap();
    if (attributeMap[key])
        return attributeMap[key];
    const columnMap = modelClass.getColumnNameToAttributeNameMap();
    const underscored = inflection.underscore(key);
    return columnMap[key] || columnMap[underscored] || undefined;
}
/**
 * Runs split where hash.
 * @param {object} args - Options.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.hash - Where hash.
 * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
 * @returns {{resolvedHash: Record<string, ReturnType<typeof JSON.parse>>, fallbackHash: Record<string, ReturnType<typeof JSON.parse>>}} - Split hashes.
 */
function splitWhereHash({ hash, modelClass }) {
    /**
     * Resolved hash.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const resolvedHash = {};
    /**
     * Fallback hash.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const fallbackHash = {};
    for (const key in hash) {
        const value = hash[key];
        const isNested = isPlainObject(value);
        const relationship = getRelationshipByName(modelClass, key);
        if (isNested && !relationship && resolveColumnName(modelClass, key)) {
            resolvedHash[key] = value;
        }
        else if (isNested) {
            if (relationship) {
                const rawTargetModelClass = relationship.getTargetModelClass();
                if (!rawTargetModelClass) {
                    fallbackHash[key] = value;
                    continue;
                }
                const targetModelClass = modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
                const nestedResult = splitWhereHash({ hash: value, modelClass: targetModelClass });
                const nestedResolvedKeys = Object.keys(nestedResult.resolvedHash);
                const nestedFallbackKeys = Object.keys(nestedResult.fallbackHash);
                if (nestedResolvedKeys.length > 0) {
                    resolvedHash[key] = nestedResult.resolvedHash;
                }
                if (nestedFallbackKeys.length > 0) {
                    const tableName = targetModelClass.tableName();
                    if (!fallbackHash[tableName])
                        fallbackHash[tableName] = {};
                    Object.assign(fallbackHash[tableName], nestedResult.fallbackHash);
                }
            }
            else {
                fallbackHash[key] = value;
            }
        }
        else if (relationship && hasRelationshipWhereOperatorTuples(value)) {
            resolvedHash[key] = normalizeRelationshipWhereOperatorTuples(value);
        }
        else {
            const columnName = resolveColumnName(modelClass, key);
            if (columnName) {
                resolvedHash[columnName] = value;
            }
            else {
                fallbackHash[key] = value;
            }
        }
    }
    return { resolvedHash, fallbackHash };
}
/**
 * Runs build join object from where hash.
 * @param {object} args - Options.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.hash - Where hash.
 * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Join object.
 */
function buildJoinObjectFromWhereHash({ hash, modelClass }) {
    /**
     * Join object.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const joinObject = {};
    for (const key in hash) {
        const value = hash[key];
        const relationship = getRelationshipByName(modelClass, key);
        if (!relationship)
            continue;
        if (isPlainObject(value)) {
            const rawTargetModelClass = relationship.getTargetModelClass();
            if (!rawTargetModelClass)
                continue;
            const targetModelClass = modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
            const nestedJoinObject = buildJoinObjectFromWhereHash({ hash: value, modelClass: targetModelClass });
            joinObject[key] = Object.keys(nestedJoinObject).length > 0 ? nestedJoinObject : true;
            continue;
        }
        if (hasRelationshipWhereOperatorTuples(value)) {
            joinObject[key] = true;
        }
    }
    return joinObject;
}
const relationshipWhereOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq", "like", ">", ">=", "<", "<="]);
/**
 * Runs normalize relationship where operator.
 * @param {string} operator - Raw relationship where operator.
 * @returns {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} - Normalized operator.
 */
function normalizeRelationshipWhereOperator(operator) {
    const operatorAliases = {
        "<": "lt",
        "<=": "lteq",
        ">": "gt",
        ">=": "gteq"
    };
    return /** @type {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} */ (operatorAliases[ /** @type {"<" | "<=" | ">" | ">="} */(operator)] || operator);
}
/**
 * Runs is relationship where operator tuple.
 * @param {ReturnType<typeof JSON.parse>} tupleValue - Candidate tuple.
 * @returns {boolean} - Whether this is a relationship where tuple.
 */
function isRelationshipWhereOperatorTuple(tupleValue) {
    if (!Array.isArray(tupleValue) || tupleValue.length < 3) {
        return false;
    }
    return typeof tupleValue[0] === "string" &&
        typeof tupleValue[1] === "string" &&
        relationshipWhereOperators.has(tupleValue[1]);
}
/**
 * Runs normalize relationship where operator tuples.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} - Normalized tuples.
 */
function normalizeRelationshipWhereOperatorTuples(value) {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid relationship where tuple container type: ${typeof value}`);
    }
    /**
     * Normalized.
     * @type {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} */
    const normalized = [];
    /**
     * Add condition.
     * @param {ReturnType<typeof JSON.parse>} conditionValue - Candidate nested condition.
     */
    const addCondition = (conditionValue) => {
        if (isRelationshipWhereOperatorTuple(conditionValue)) {
            const tuple = /** @type {[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like" | ">" | ">=" | "<" | "<=", unknown, ...Array<unknown>]} */ (conditionValue);
            const normalizedOperator = normalizeRelationshipWhereOperator(tuple[1]);
            normalized.push([
                tuple[0],
                normalizedOperator,
                tuple[2]
            ]);
            if (tuple.length > 3) {
                for (let index = 3; index < tuple.length; index += 1) {
                    addCondition(tuple[index]);
                }
            }
            return;
        }
        if (!Array.isArray(conditionValue)) {
            throw new Error("Relationship where conditions must be tuples");
        }
        /** @type {Array<ReturnType<typeof JSON.parse>>} */ (conditionValue).forEach((nestedConditionValue) => {
            addCondition(nestedConditionValue);
        });
    };
    addCondition(value);
    if (normalized.length < 1) {
        throw new Error("Relationship where tuple container cannot be empty");
    }
    return normalized;
}
/**
 * Runs has relationship where operator tuples.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate relationship where value.
 * @returns {boolean} - Whether value can be normalized to relationship tuples.
 */
function hasRelationshipWhereOperatorTuples(value) {
    try {
        normalizeRelationshipWhereOperatorTuples(value);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtY2xhc3MtcXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLGlCQUFpQixDQUFBO0FBQzdDLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLG9DQUFvQyxDQUFBO0FBQ3BFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sU0FBUyxNQUFNLGdCQUFnQixDQUFBO0FBQ3RDLE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxZQUFZLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsWUFBWSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sWUFBWSxDQUFBO0FBQ3RDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sbUJBQW1CLE1BQU0scUNBQXFDLENBQUE7QUFDckUsT0FBTyxFQUFDLHFCQUFxQixFQUFFLGdCQUFnQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDOUUsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDakUsT0FBTyxFQUFDLHlCQUF5QixFQUFFLHFCQUFxQixFQUFDLE1BQU0sa0NBQWtDLENBQUE7QUFDakcsT0FBTyxlQUFlLE1BQU0sdUJBQXVCLENBQUE7QUFDbkQsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFP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SixDQUFDLENBQUE7SUFFRCxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7SUFFbkIsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtDQUFrQyxDQUFDLEtBQUs7SUFDL0MsSUFBSSxDQUFDO1FBQ0gsd0NBQXdDLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFL0MsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCB7Y3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMsIHJ1blF1ZXJ5RGF0YX0gZnJvbSBcIi4vcXVlcnktZGF0YS5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVdpdGhDb3VudCwgcnVuV2l0aENvdW50fSBmcm9tIFwiLi93aXRoLWNvdW50LmpzXCJcbmltcG9ydCBEYXRhYmFzZVF1ZXJ5IGZyb20gXCIuL2luZGV4LmpzXCJcbmltcG9ydCBKb2luT2JqZWN0IGZyb20gXCIuL2pvaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBKb2luUGxhaW4gZnJvbSBcIi4vam9pbi1wbGFpbi5qc1wiXG5pbXBvcnQgSm9pblRyYWNrZXIgZnJvbSBcIi4vam9pbi10cmFja2VyLmpzXCJcbmltcG9ydCBSZWNvcmROb3RGb3VuZEVycm9yIGZyb20gXCIuLi9yZWNvcmQvcmVjb3JkLW5vdC1mb3VuZC1lcnJvci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVJhbnNhY2tHcm91cCwgcGFyc2VSYW5zYWNrU29ydH0gZnJvbSBcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIlxuaW1wb3J0IHtpc01vZGVsU2NvcGVEZXNjcmlwdG9yfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCBzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgV2hlcmVDb21iaW5hdG9yIGZyb20gXCIuL3doZXJlLWNvbWJpbmF0b3IuanNcIlxuaW1wb3J0IFdoZXJlTW9kZWxDbGFzc0hhc2ggZnJvbSBcIi4vd2hlcmUtbW9kZWwtY2xhc3MtaGFzaC5qc1wiXG5pbXBvcnQgV2hlcmVOb3QgZnJvbSBcIi4vd2hlcmUtbm90LmpzXCJcbmltcG9ydCBKb2luc1BhcnNlciBmcm9tIFwiLi4vcXVlcnktcGFyc2VyL2pvaW5zLXBhcnNlci5qc1wiXG5pbXBvcnQgV2hlcmVQYXJzZXIgZnJvbSBcIi4uL3F1ZXJ5LXBhcnNlci93aGVyZS1wYXJzZXIuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtNQz10eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5RdWVyeUFyZ3NUeXBlICYge21vZGVsQ2xhc3M6IE1DLCBqb2luQmFzZVBhdGg/OiBzdHJpbmdbXSwgam9pblRyYWNrZXI/OiBpbXBvcnQoXCIuL2pvaW4tdHJhY2tlci5qc1wiKS5kZWZhdWx0LCBmb3JjZVF1YWxpZnlCYXNlVGFibGU/OiBib29sZWFuLCB3aXRoQ291bnQ/OiBpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50RW50cnlbXSwgcXVlcnlEYXRhPzogaW1wb3J0KFwiLi9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUVudHJ5W10sIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gTW9kZWxDbGFzc1F1ZXJ5QXJnc1R5cGVcbiAqL1xuLyoqXG4gKiBSdW5zIHVucXVvdGUgc3FsIGlkZW50aWZpZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBQb3RlbnRpYWxseSBxdW90ZWQgU1FMIGlkZW50aWZpZXIuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIGlkZW50aWZpZXIuXG4gKi9cbmZ1bmN0aW9uIHVucXVvdGVTcWxJZGVudGlmaWVyKHZhbHVlKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAodHJpbW1lZC5sZW5ndGggPj0gMiAmJiAoKHRyaW1tZWQuc3RhcnRzV2l0aChcImBcIikgJiYgdHJpbW1lZC5lbmRzV2l0aChcImBcIikpIHx8ICh0cmltbWVkLnN0YXJ0c1dpdGgoXCJcXFwiXCIpICYmIHRyaW1tZWQuZW5kc1dpdGgoXCJcXFwiXCIpKSkpIHtcbiAgICByZXR1cm4gdHJpbW1lZC5zbGljZSgxLCAtMSlcbiAgfVxuXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+PSAyICYmIHRyaW1tZWQuc3RhcnRzV2l0aChcIltcIikgJiYgdHJpbW1lZC5lbmRzV2l0aChcIl1cIikpIHtcbiAgICByZXR1cm4gdHJpbW1lZC5zbGljZSgxLCAtMSlcbiAgfVxuXG4gIHJldHVybiB0cmltbWVkXG59XG5cbi8qKlxuICogUnVucyBwYXJzZSBmcm9tIHBsYWluIHRhYmxlIHJlZmVyZW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmcm9tUGxhaW4gLSBGUk9NIGNsYXVzZSBzb3VyY2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBQYXJzZWQgdGFibGUgcmVmZXJlbmNlIG9yIG51bGwgd2hlbiB1bnN1cHBvcnRlZC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VGcm9tUGxhaW5UYWJsZVJlZmVyZW5jZShmcm9tUGxhaW4pIHtcbiAgY29uc3QgdHJpbW1lZCA9IGZyb21QbGFpbi50cmltKClcblxuICBpZiAodHJpbW1lZC5sZW5ndGggPCAxKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGFsaWFzTWF0Y2ggPSB0cmltbWVkLm1hdGNoKC8oPzpefFxccykoPzpBU1xccyspPyhbYFwiXT9bYS16QS1aX11bYS16QS1aMC05X10qW2BcIl0/fFxcW1thLXpBLVpfXVthLXpBLVowLTlfXSpcXF0pXFxzKiQvaSlcblxuICBpZiAoIWFsaWFzTWF0Y2ggfHwgIWFsaWFzTWF0Y2hbMV0pIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIHVucXVvdGVTcWxJZGVudGlmaWVyKGFsaWFzTWF0Y2hbMV0pXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc2NvcGUgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW119IHBhdGggLSBTY29wZSBwYXRoIGlucHV0LlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgcGF0aC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU2NvcGVQYXRoKHBhdGgpIHtcbiAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiKSB7XG4gICAgaWYgKHBhdGgubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiU2NvcGUgcGF0aCBzdHJpbmdzIG11c3QgYmUgbm9uLWVtcHR5XCIpXG5cbiAgICByZXR1cm4gW3BhdGhdXG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2NvcGUgcGF0aCB0eXBlOiAke3R5cGVvZiBwYXRofWApXG4gIH1cblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBhdGgpIHtcbiAgICBpZiAodHlwZW9mIGVudHJ5ICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlNjb3BlIHBhdGggZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzXCIpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIFsuLi5wYXRoXVxufVxuXG4vKipcbiAqIE5hcnJvd3MgYSBzaGFyZWQgbW9kZWwtc2NvcGUgZGVzY3JpcHRvciB0byB0aGUgYmFja2VuZCBtb2RlbCBjbGFzcyByZXF1aXJlZCBieSBNb2RlbENsYXNzUXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfSBzY29wZURlc2NyaXB0b3IgLSBTaGFyZWQgc2NvcGUgZGVzY3JpcHRvci5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gQmFja2VuZCBzY29wZSBvd25lci5cbiAqL1xuZnVuY3Rpb24gYmFja2VuZFNjb3BlTW9kZWxDbGFzcyhzY29wZURlc2NyaXB0b3IpIHtcbiAgY29uc3QgbW9kZWxDbGFzcyA9IHNjb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzXG5cbiAgaWYgKCEoXCJjYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcIiBpbiBtb2RlbENsYXNzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkEgZnJvbnRlbmQtbW9kZWwgc2NvcGUgY2Fubm90IGJlIGFwcGxpZWQgdG8gYSBkYXRhYmFzZSByZWNvcmQgcXVlcnlcIilcbiAgfVxuXG4gIC8vIFRoZSBydW50aW1lIG1lbWJlciBjaGVjayBhYm92ZSBuYXJyb3dzIHRoZSBzaGFyZWQgZnJvbnRlbmQvYmFja2VuZCBkZXNjcmlwdG9yIGJvdW5kYXJ5LlxuICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIERlZXAtY29waWVzIGEgcHJlbG9hZCBzZWxlY3QgbWFwIChrZXllZCBieSBtb2RlbCBuYW1lIHdpdGggYXR0cmlidXRlIGFycmF5cylcbiAqIHNvIGEgY2xvbmVkIHF1ZXJ5J3Mgc2VsZWN0aW9ucyBjYW4gYmUgbXV0YXRlZCB3aXRob3V0IGFmZmVjdGluZyB0aGUgb3JpZ2luYWwuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gbWFwIC0gUHJlbG9hZCBzZWxlY3QgbWFwIHRvIGNvcHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAtIEEgY29weSB3aXRoIGluZGVwZW5kZW50IGFycmF5cy5cbiAqL1xuZnVuY3Rpb24gY2xvbmVQcmVsb2FkU2VsZWN0TWFwKG1hcCkge1xuICAvKipcbiAgICogUmVzdWx0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICBjb25zdCByZXN1bHQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMobWFwKSkge1xuICAgIHJlc3VsdFttb2RlbE5hbWVdID0gWy4uLmF0dHJpYnV0ZXNdXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcHJlbG9hZCByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIGRhdGEgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gLSBOb3JtYWxpemVkIHByZWxvYWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVQcmVsb2FkUmVjb3JkKHByZWxvYWQpIHtcbiAgaWYgKCFwcmVsb2FkKSByZXR1cm4ge31cblxuICBpZiAodHlwZW9mIHByZWxvYWQgPT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7W3ByZWxvYWRdOiB0cnVlfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocHJlbG9hZCkpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcmVsb2FkKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgcmVzdWx0W2VudHJ5XSA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QoZW50cnkpKSB7XG4gICAgICAgIGluY29ycG9yYXRlKHJlc3VsdCwgbm9ybWFsaXplUHJlbG9hZFJlY29yZChlbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcmVsb2FkIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHByZWxvYWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdHlwZTogJHt0eXBlb2YgcHJlbG9hZH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3VsdC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge31cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgIHJlc3VsdFtrZXldID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcInN0cmluZ1wiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpIHx8IGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICByZXN1bHRba2V5XSA9IG5vcm1hbGl6ZVByZWxvYWRSZWNvcmQodmFsdWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcmVsb2FkIHZhbHVlIGZvciAke2tleX06ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW01DPXR5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqL1xuXG4vKipcbiAqIEEgZ2VuZXJpYyBxdWVyeSBvdmVyIHNvbWUgbW9kZWwgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5IGV4dGVuZHMgRGF0YWJhc2VRdWVyeSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge01vZGVsQ2xhc3NRdWVyeUFyZ3NUeXBlPE1DPn0gYXJncyAtIFF1ZXJ5IGNvbnN0cnVjdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBjb25zdCB7bW9kZWxDbGFzc30gPSBhcmdzXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gbW9kZWxDbGFzcyBnaXZlbiBpbiAke09iamVjdC5rZXlzKGFyZ3MpLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgc3VwZXIoYXJncylcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TUN9ICovXG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICB0aGlzLl9qb2luQmFzZVBhdGggPSBhcmdzLmpvaW5CYXNlUGF0aCB8fCBbXVxuICAgIHRoaXMuX2pvaW5UcmFja2VyID0gYXJncy5qb2luVHJhY2tlciB8fCBuZXcgSm9pblRyYWNrZXIoe21vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzc30pXG4gICAgdGhpcy5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gQm9vbGVhbihhcmdzLmZvcmNlUXVhbGlmeUJhc2VUYWJsZSlcbiAgICB0aGlzLl9vcGVyYXRpb24gPSBhcmdzLm9wZXJhdGlvblxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50RW50cnlbXX0gKi9cbiAgICB0aGlzLl93aXRoQ291bnQgPSBhcmdzLndpdGhDb3VudCA/IFsuLi5hcmdzLndpdGhDb3VudF0gOiBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRW50cnlbXX0gKi9cbiAgICB0aGlzLl9xdWVyeURhdGEgPSBhcmdzLnF1ZXJ5RGF0YSA/IFsuLi5hcmdzLnF1ZXJ5RGF0YV0gOiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvbmUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBjbG9uZS5cbiAgICovXG4gIGNsb25lKCkge1xuICAgIGNvbnN0IG5ld1F1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKG5ldyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5KHtcbiAgICAgIGRyaXZlcjogdGhpcy5fZHJpdmVyRm4sXG4gICAgICBmcm9tczogWy4uLnRoaXMuX2Zyb21zXSxcbiAgICAgIGhhbmRsZXI6IHRoaXMuaGFuZGxlci5jbG9uZSgpLFxuICAgICAgZ3JvdXBzOiBbLi4udGhpcy5fZ3JvdXBzXSxcbiAgICAgIGpvaW5zOiBbLi4udGhpcy5fam9pbnNdLFxuICAgICAgbGltaXQ6IHRoaXMuX2xpbWl0LFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgb2Zmc2V0OiB0aGlzLl9vZmZzZXQsXG4gICAgICBvcmRlcnM6IFsuLi50aGlzLl9vcmRlcnNdLFxuICAgICAgcGFnZTogdGhpcy5fcGFnZSxcbiAgICAgIHBlclBhZ2U6IHRoaXMuX3BlclBhZ2UsXG4gICAgICBwcmVsb2FkOiB7Li4udGhpcy5fcHJlbG9hZH0sXG4gICAgICBwcmVsb2FkU2VsZWN0czogY2xvbmVQcmVsb2FkU2VsZWN0TWFwKHRoaXMuX3ByZWxvYWRTZWxlY3RzKSxcbiAgICAgIHByZWxvYWRTZWxlY3RzRXh0cmE6IGNsb25lUHJlbG9hZFNlbGVjdE1hcCh0aGlzLl9wcmVsb2FkU2VsZWN0c0V4dHJhKSxcbiAgICAgIGRpc3RpbmN0OiB0aGlzLl9kaXN0aW5jdCxcbiAgICAgIHNlbGVjdHM6IFsuLi50aGlzLl9zZWxlY3RzXSxcbiAgICAgIHNpZ25hbDogdGhpcy5fc2lnbmFsLFxuICAgICAgd2hlcmVzOiBbLi4udGhpcy5fd2hlcmVzXSxcbiAgICAgIGpvaW5CYXNlUGF0aDogWy4uLnRoaXMuX2pvaW5CYXNlUGF0aF0sXG4gICAgICBqb2luVHJhY2tlcjogdGhpcy5fam9pblRyYWNrZXIuY2xvbmUoKSxcbiAgICAgIGZvcmNlUXVhbGlmeUJhc2VUYWJsZTogdGhpcy5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlLFxuICAgICAgd2l0aENvdW50OiBbLi4udGhpcy5fd2l0aENvdW50XSxcbiAgICAgIHF1ZXJ5RGF0YTogWy4uLnRoaXMuX3F1ZXJ5RGF0YV0sXG4gICAgICBvcGVyYXRpb246IHRoaXMuX29wZXJhdGlvblxuICAgIH0pKVxuXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIHJldHVybiBuZXdRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFRlbGwgdGhlIHF1ZXJ5IHRvIGF0dGFjaCBvbmUgb3IgbW9yZSBhc3NvY2lhdGlvbiBjb3VudHMgb250byBldmVyeVxuICAgKiBsb2FkZWQgcmVjb3JkLiBUaGUgY291bnRzIGxhbmQgYXMgcmVndWxhciBhdHRyaWJ1dGVzIG9uIGVhY2ggcmVjb3JkO1xuICAgKiByZWFkIHRoZW0gd2l0aCBgbW9kZWwucmVhZEF0dHJpYnV0ZShcIjxuYW1lPkNvdW50XCIpYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50U3BlY30gc3BlYyAtIENvdW50IHNwZWMgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5LCBmb3IgY2hhaW5pbmcuXG4gICAqL1xuICB3aXRoQ291bnQoc3BlYykge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygbm9ybWFsaXplV2l0aENvdW50KHNwZWMpKSB7XG4gICAgICB0aGlzLl93aXRoQ291bnQucHVzaChlbnRyeSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBvbmUgb3IgbW9yZSBjb25zdW1lci1kZWZpbmVkLCBwZXItcm93IGNvbXB1dGVkIHZhbHVlcyBvbnRvXG4gICAqIGV2ZXJ5IGxvYWRlZCByb290IHJlY29yZC4gTGVhZiBzdHJpbmdzIGluIHRoZSBzcGVjIGFyZSBuYW1lcyBvZlxuICAgKiBmdW5jdGlvbnMgcHJldmlvdXNseSByZWdpc3RlcmVkIHZpYSBgTW9kZWwucXVlcnlEYXRhKG5hbWUsIGZuKWAuXG4gICAqIE5lc3RlZCBvYmplY3Qga2V5cyBhcmUgcmVsYXRpb25zaGlwIG5hbWVzIHRyYWNlZCBmcm9tIHRoZSByb290IHRvXG4gICAqIHRoZSBtb2RlbCB0aGF0IGRlY2xhcmVzIHRoZSBmbi4gRXZlcnkgcmVzdWx0aW5nIFNFTEVDVCBhbGlhcyBpc1xuICAgKiBhdHRhY2hlZCB0byB0aGUgKipyb290KiogcmVjb3JkIChub3QgdG8gdGhlIGludGVybWVkaWF0ZSBqb2luZWRcbiAgICogcm93cyk7IHJlYWQgdmFsdWVzIHdpdGggYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuXG4gICAqXG4gICAqIFNlZSBhbHNvIGBzcmMvZGF0YWJhc2UvcXVlcnkvcXVlcnktZGF0YS5qc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YVNwZWN9IHNwZWMgLSBTcGVjIGluIHNob3J0aGFuZCBvciBuZXN0ZWQgZm9ybS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSwgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgcXVlcnlEYXRhKHNwZWMpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMoc3BlYykpIHtcbiAgICAgIHRoaXMuX3F1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpIHJlZ2lzdGVyZWQgZm9yIHRoZVxuICAgKiBnaXZlbiByZWxhdGlvbnNoaXAgY2hhaW4sIHJlbGF0aXZlIHRvIHRoZSBxdWVyeSdzIGN1cnJlbnQgam9pbiBiYXNlXG4gICAqIHBhdGguIENvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBnZXRUYWJsZVJlZmVyZW5jZUZvckpvaW5gIGZvciB1c2VcbiAgICogaW5zaWRlIGBxdWVyeURhdGFgIGNhbGxiYWNrcyB3aGVyZSB0aGUgd3JpdGVyJ3MgaW50ZW50IHJlYWRzIG1vcmVcbiAgICogbmF0dXJhbGx5IGFzIFwiZ2l2ZSBtZSB0aGUgdGFibGUgbmFtZSBmb3IgJ3Rhc2tzJ1wiLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIHNlZ21lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIHRhYmxlIHJlZmVyZW5jZS5cbiAgICovXG4gIHRhYmxlTmFtZUZvciguLi5wYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50KCkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKClcblxuICAgIC8vIEEgbW9kZWwgd2l0aG91dCBhIHNpbmdsZSBwcmltYXJ5LWtleSBjb2x1bW4g4oCUIHNldFByaW1hcnlLZXkobnVsbCkgb3IgYSBjb21wb3NpdGVcbiAgICAvLyBzZXRQcmltYXJ5S2V5KFsuLi5dKSBvbiBsZWdhY3kgdGFibGVzIOKAlCBoYXMgbm8gY29sdW1uIENPVU5UIGNhbiByZWZlcmVuY2UgKGFuIGFycmF5IHByaW1hcnkga2V5XG4gICAgLy8gY2Fubm90IGJlIHF1b3RlZCBhcyBhIHNpbmdsZSBDT1VOVChjb2x1bW4pLCBhbmQgcHJpbWFyeUtleSgpIGZhbGxzIGJhY2sgdG8gXCJpZFwiIGZvciB0aGUgbm8tcGtcbiAgICAvLyBjYXNlLCBzbyBoYXNQcmltYXJ5S2V5KCkgZGV0ZWN0cyB0aGF0IG9uZSkuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGhhc1NpbmdsZUNvbHVtblByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5oYXNQcmltYXJ5S2V5KCkgJiYgIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcblxuICAgIC8vIFBhZ2luYXRpb24sIG9yIGFuIHVuZ3JvdXBlZCBxdWVyeSBvbiBhIG1vZGVsIHdpdGggbm8gc2luZ2xlIHByaW1hcnkta2V5IGNvbHVtbiwgY291bnRzIHZpYSB0aGVcbiAgICAvLyBzdWJxdWVyeSBmb3JtLiBJdCByZWZlcmVuY2VzIG5vIHByaW1hcnkta2V5IGNvbHVtbiBhbmQgcHJlc2VydmVzIERJU1RJTkNUIG92ZXIgam9pbnMg4oCUIHdoaWNoIGFcbiAgICAvLyBiYXJlIENPVU5UKCopIHdvdWxkIG5vdCAoaXQgd291bGQgY291bnQgam9pbmVkIGR1cGxpY2F0ZSByb3dzIGluc3RlYWQgb2YgZGlzdGluY3Qgcm9vdCByb3dzKS5cbiAgICAvLyBBIGdyb3VwZWQgcXVlcnkgc3RheXMgb24gdGhlIHBlci1ncm91cCBmbG93IGJlbG93LCBiZWNhdXNlIHRoZSBzdWJxdWVyeSBmb3JtIHdvdWxkIGNvdW50IG9uZVxuICAgIC8vIHJvdyBwZXIgZ3JvdXAgaW5zdGVhZCBvZiBzdW1taW5nIGVhY2ggZ3JvdXAncyByb3cgY291bnQuXG4gICAgaWYgKHRoaXMuX2xpbWl0ICE9PSBudWxsIHx8IHRoaXMuX29mZnNldCAhPT0gbnVsbCB8fCAoIWhhc1NpbmdsZUNvbHVtblByaW1hcnlLZXkgJiYgdGhpcy5fZ3JvdXBzLmxlbmd0aCA9PSAwKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucGFnaW5hdGVkQ291bnQoKVxuICAgIH1cblxuICAgIGlmICghaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleSAmJiB0aGlzLl9kaXN0aW5jdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW4ndCBjb3VudCBhIGdyb3VwZWQgZGlzdGluY3QgcXVlcnkgb24gJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBiZWNhdXNlIGl0IGhhcyBubyBzaW5nbGUgcHJpbWFyeS1rZXkgY29sdW1uIHRvIGNvdW50IGRpc3RpbmN0IHZhbHVlcyBvZmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlzdGluY3RQcmVmaXggPSB0aGlzLl9kaXN0aW5jdCA/IFwiRElTVElOQ1QgXCIgOiBcIlwiXG4gICAgY29uc3QgY291bnRFeHByZXNzaW9uID0gaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleVxuICAgICAgPyBgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbigvKiogQHR5cGUge3N0cmluZ30gKi8gKHByaW1hcnlLZXkpKX1gXG4gICAgICA6IFwiKlwiXG4gICAgbGV0IHNxbCA9IGBDT1VOVCgke2Rpc3RpbmN0UHJlZml4fSR7Y291bnRFeHByZXNzaW9ufSlgXG5cbiAgICBpZiAodGhpcy5kcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIikgc3FsICs9IFwiOjppbnRcIlxuXG4gICAgc3FsICs9IFwiIEFTIGNvdW50XCJcblxuICAgIC8vIENsb25lIHF1ZXJ5IGFuZCBleGVjdXRlIGNvdW50XG4gICAgY29uc3QgY291bnRRdWVyeSA9IHRoaXMuY2xvbmUoKVxuXG4gICAgY291bnRRdWVyeS5fZGlzdGluY3QgPSBmYWxzZVxuICAgIGNvdW50UXVlcnkuX3NlbGVjdHMgPSBbXVxuICAgIGNvdW50UXVlcnkuc2VsZWN0KHNxbClcblxuICAgIGNvbnN0IHJlc3VsdHMgPSAvKiogQHR5cGUge3tjb3VudDogbnVtYmVyfVtdfSAqLyAoYXdhaXQgY291bnRRdWVyeS5fZXhlY3V0ZVF1ZXJ5KHtcbiAgICAgIGxvZ05hbWU6IGNvdW50UXVlcnkucXVlcnlMb2dOYW1lKFwiQ291bnRcIilcbiAgICB9KSlcblxuICAgIC8vIFRoZSBxdWVyeSBpc24ndCBncm91cGVkIGFuZCBhIHNpbmdsZSByZXN1bHQgaGFzIGJlZW4gZ2l2ZW5cbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT0gMSkge1xuICAgICAgcmV0dXJuIHJlc3VsdHNbMF0uY291bnRcbiAgICB9XG5cbiAgICAvLyBUaGUgcXVlcnkgbWF5IGJlIGdyb3VwZWQgYW5kIGEgbG90IG9mIGRpZmZlcmVudCBjb3VudHMgYSBnaXZlblxuICAgIGxldCBjb3VudFJlc3VsdCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgIGlmICghKFwiY291bnRcIiBpbiByZXN1bHQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgY291bnQgcmVzdWx0XCIpXG4gICAgICB9XG5cbiAgICAgIGNvdW50UmVzdWx0ICs9IHJlc3VsdC5jb3VudFxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnaW5hdGVkIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvdW50IGFmdGVyIHBhZ2luYXRpb24gaXMgYXBwbGllZC5cbiAgICovXG4gIGFzeW5jIHBhZ2luYXRlZENvdW50KCkge1xuICAgIGNvbnN0IGNvdW50UXVlcnkgPSB0aGlzLmNsb25lKClcbiAgICBjb25zdCBjb3VudFNxbCA9IHRoaXMuZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCIgPyBcIkNPVU5UKCopOjppbnRcIiA6IFwiQ09VTlQoKilcIlxuICAgIGNvbnN0IHNxbCA9IFtcbiAgICAgIGBTRUxFQ1QgJHtjb3VudFNxbH0gQVMgJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihcImNvdW50XCIpfWAsXG4gICAgICBgRlJPTSAoJHtjb3VudFF1ZXJ5LnRvU3FsKCl9KSBBUyAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUoXCJwYWdpbmF0ZWRfY291bnRfcm93c1wiKX1gXG4gICAgXS5qb2luKFwiIFwiKVxuICAgIGNvbnN0IHJlc3VsdHMgPSAvKiogQHR5cGUge3tjb3VudDogbnVtYmVyfVtdfSAqLyAoYXdhaXQgdGhpcy5kcml2ZXIucXVlcnkoXG4gICAgICBzcWwsXG4gICAgICB7bG9nTmFtZTogdGhpcy5xdWVyeUxvZ05hbWUoXCJDb3VudFwiKSwgc2lnbmFsOiB0aGlzLl9zaWduYWx9XG4gICAgKSlcblxuICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxIHx8ICEoXCJjb3VudFwiIGluIHJlc3VsdHNbMF0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGNvdW50IHJlc3VsdFwiKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzWzBdLmNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5TZWxlY3RBcmd1bWVudFR5cGV9IHNlbGVjdCAtIFNlbGVjdC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHNlbGVjdC5cbiAgICovXG4gIHNlbGVjdChzZWxlY3QpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgICBmb3IgKGNvbnN0IHNlbGVjdEVudHJ5IG9mIHNlbGVjdCkge1xuICAgICAgICB0aGlzLnNlbGVjdChzZWxlY3RFbnRyeSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHNlbGVjdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgdHJpbW1lZFNlbGVjdCA9IHNlbGVjdC50cmltKClcblxuICAgICAgaWYgKC9eW2EtekEtWl9dW2EtekEtWjAtOV9dKiQvLnRlc3QodHJpbW1lZFNlbGVjdCkpIHtcbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBhdHRyaWJ1dGVNYXBbdHJpbW1lZFNlbGVjdF0gfHwgdHJpbW1lZFNlbGVjdFxuICAgICAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHRoaXMucm9vdFRhYmxlUmVmZXJlbmNlKClcbiAgICAgICAgY29uc3QgcXVhbGlmaWVkQ29sdW1uID0gYCR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7dGhpcy5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgICAgIHJldHVybiBzdXBlci5zZWxlY3QocXVhbGlmaWVkQ29sdW1uKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9iamVjdCBmb3JtIGtleWVkIGJ5IHRhcmdldCBtb2RlbCBuYW1lLCBlLmcuIGAuc2VsZWN0KHtBY2NvdW50OiBbXCJpZFwiXX0pYC5cbiAgICAvLyBUaGVzZSBsaW1pdCB0aGUgYXR0cmlidXRlcyBsb2FkZWQgZm9yIHByZWxvYWRlZCByZWxhdGlvbnNoaXAgdGFyZ2V0c1xuICAgIC8vIHJhdGhlciB0aGFuIHRoZSByb290IHF1ZXJ5J3MgU0VMRUNUIGNsYXVzZS5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChzZWxlY3QpKSB7XG4gICAgICB0aGlzLl9tZXJnZVByZWxvYWRTZWxlY3QodGhpcy5fcHJlbG9hZFNlbGVjdHMsIHNlbGVjdClcblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuc2VsZWN0KHNlbGVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZGVmYXVsdCBjb2x1bW5zIHBsdXMgdGhlIGdpdmVuIGV4dHJhIHNlbGVjdHMgZm9yIHByZWxvYWRlZFxuICAgKiByZWxhdGlvbnNoaXAgdGFyZ2V0cywga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUsIGUuZy5cbiAgICogYC5zZWxlY3RzRXh0cmEoe0FjY291bnQ6IFtcIihTRUxFQ1QgY291bnQoKikgRlJPTSBwcm9qZWN0cykgQVMgcHJvamVjdHNfY291bnRcIl19KWAuXG4gICAqIFVubGlrZSBgc2VsZWN0KHsuLi59KWAsIHdoaWNoIG5hcnJvd3MgdG8gb25seSB0aGUgbGlzdGVkIGNvbHVtbnMsIHRoaXMga2VlcHNcbiAgICogdGhlIGRlZmF1bHQgYFNFTEVDVCAqYCBjb2x1bW5zIGFuZCBhZGRzIHRoZSBleHRyYXMgb24gdG9wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gc2VsZWN0IC0gRXh0cmEgc2VsZWN0cyBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSwgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgc2VsZWN0c0V4dHJhKHNlbGVjdCkge1xuICAgIHRoaXMuX21lcmdlUHJlbG9hZFNlbGVjdCh0aGlzLl9wcmVsb2FkU2VsZWN0c0V4dHJhLCBzZWxlY3QpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyBhbiBvYmplY3QtZm9ybSBwcmVsb2FkIHNlbGVjdCAoa2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUpIGludG8gdGhlXG4gICAqIGdpdmVuIHRhcmdldCBtYXAsIGRlLWR1cGxpY2F0aW5nIGF0dHJpYnV0ZS9leHByZXNzaW9uIGVudHJpZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXQgLSBNYXAgdG8gbWVyZ2UgaW50by5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IHNlbGVjdCAtIE9iamVjdC1mb3JtIHNlbGVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21lcmdlUHJlbG9hZFNlbGVjdCh0YXJnZXQsIHNlbGVjdCkge1xuICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMoc2VsZWN0KSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpID8gYXR0cmlidXRlcyA6IFthdHRyaWJ1dGVzXVxuXG4gICAgICBpZiAoIXRhcmdldFttb2RlbE5hbWVdKSB0YXJnZXRbbW9kZWxOYW1lXSA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICghdGFyZ2V0W21vZGVsTmFtZV0uaW5jbHVkZXMoYXR0cmlidXRlKSkgdGFyZ2V0W21vZGVsTmFtZV0ucHVzaChhdHRyaWJ1dGUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9vdCB0YWJsZSByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUm9vdCB0YWJsZSByZWZlcmVuY2UgZm9yIHF1ZXJ5IHNlbGVjdCBxdWFsaWZpY2F0aW9uLlxuICAgKi9cbiAgcm9vdFRhYmxlUmVmZXJlbmNlKCkge1xuICAgIGNvbnN0IGZyb21zID0gdGhpcy5nZXRGcm9tcygpXG4gICAgY29uc3QgbGFzdEZyb20gPSBmcm9tc1tmcm9tcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKGxhc3RGcm9tICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnRhYmxlTmFtZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkudGFibGVOYW1lXG4gICAgfVxuXG4gICAgaWYgKGxhc3RGcm9tICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnBsYWluID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCBwYXJzZWRSZWZlcmVuY2UgPSBwYXJzZUZyb21QbGFpblRhYmxlUmVmZXJlbmNlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkucGxhaW4pXG5cbiAgICAgIGlmIChwYXJzZWRSZWZlcmVuY2UpIHJldHVybiBwYXJzZWRSZWZlcmVuY2VcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7TUN9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwibW9kZWxDbGFzcyBub3Qgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgbW9kZWwgdGFibGUgbWV0YWRhdGEgaXMgbG9hZGVkIGJlZm9yZSBhbiBvcGVyYXRpb24gdGhhdCBuZWVkcyBpdC5cbiAgICogUXVlcnkgYnVpbGRlcnMgc3RheSBzeW5jaHJvbm91cyBhbmQgbWV0YWRhdGEtZnJlZTsgZXhlY3V0aW9uIGluaXRpYWxpemVzIGxhemlseS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgaXMgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSW5pdGlhbGl6ZWQoKSB7XG4gICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRpb25zaGlwIHRhcmdldCB0byB0aGlzIHF1ZXJ5J3MgcGh5c2ljYWwgZGF0YWJhc2UgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBDYW5vbmljYWwgcmVsYXRpb25zaGlwIHRhcmdldC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBRdWVyeS1ib3VuZCByZWxhdGlvbnNoaXAgdGFyZ2V0LlxuICAgKi9cbiAgYmluZE1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbiBiYXNlIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgam9pbiBiYXNlIHBhdGguXG4gICAqL1xuICBnZXRKb2luQmFzZVBhdGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2pvaW5CYXNlUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvaW4gdHJhY2tlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vam9pbi10cmFja2VyLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGpvaW4gdHJhY2tlci5cbiAgICovXG4gIGdldEpvaW5UcmFja2VyKCkge1xuICAgIHJldHVybiB0aGlzLl9qb2luVHJhY2tlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZvcmNlIHF1YWxpZnkgYmFzZSB0YWJsZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBxdWFsaWZ5IGJhc2UgdGFibGUuXG4gICAqL1xuICBnZXRGb3JjZVF1YWxpZnlCYXNlVGFibGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGpvaW4gYmFzZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBqb2luQmFzZVBhdGggLSBKb2luIGJhc2UgcGF0aC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHF1ZXJ5IHdpdGggdXBkYXRlZCBiYXNlIHBhdGguXG4gICAqL1xuICBzZXRKb2luQmFzZVBhdGgoam9pbkJhc2VQYXRoKSB7XG4gICAgdGhpcy5fam9pbkJhc2VQYXRoID0gam9pbkJhc2VQYXRoXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBqb2luQmFzZVBhdGggLSBKb2luIGJhc2UgcGF0aC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBzY29wZWQgcXVlcnkuXG4gICAqL1xuICB3aXRoSm9pblBhdGgoam9pbkJhc2VQYXRoKSB7XG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5CYXNlUGF0aCA9IGpvaW5CYXNlUGF0aFxuICAgIHNjb3BlZFF1ZXJ5Ll9qb2luVHJhY2tlciA9IHRoaXMuX2pvaW5UcmFja2VyXG5cbiAgICByZXR1cm4gc2NvcGVkUXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgdGFibGUgbmFtZSBmb3Igam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRhYmxlIG5hbWUgZm9yIHBhdGguXG4gICAqL1xuICBfcmVzb2x2ZVRhYmxlTmFtZUZvckpvaW5QYXRoKHBhdGgpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzb2x2ZU1vZGVsQ2xhc3NGb3JKb2luUGF0aChwYXRoKS50YWJsZU5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBtb2RlbCBjbGFzcyBmb3Igam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIF9yZXNvbHZlTW9kZWxDbGFzc0ZvckpvaW5QYXRoKHBhdGgpIHtcbiAgICBsZXQgbW9kZWxDbGFzcyA9IHRoaXMuX2pvaW5UcmFja2VyLmdldFJvb3RNb2RlbENsYXNzKClcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIG1vZGVsQ2xhc3MgPSB0aGlzLmJpbmRNb2RlbENsYXNzKHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3t0YWJsZU5hbWU6IHN0cmluZywgYWxpYXM6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gVGhlIGVudHJ5LlxuICAgKi9cbiAgX3JlZ2lzdGVySm9pblBhdGgocGF0aCkge1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuX3Jlc29sdmVUYWJsZU5hbWVGb3JKb2luUGF0aChwYXRoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2pvaW5UcmFja2VyLnJlZ2lzdGVyUGF0aChwYXRoLCB0YWJsZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbiB0YWJsZSByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVW5xdW90ZWQgdGFibGUgcmVmZXJlbmNlIChhbGlhcyBvciB0YWJsZSBuYW1lKS5cbiAgICovXG4gIGdldEpvaW5UYWJsZVJlZmVyZW5jZShwYXRoKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9qb2luVHJhY2tlci5nZXRFbnRyeShwYXRoKSB8fCB0aGlzLl9yZWdpc3RlckpvaW5QYXRoKHBhdGgpXG5cbiAgICByZXR1cm4gZW50cnkuYWxpYXMgfHwgZW50cnkudGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgcmVmZXJlbmNlIGZvciBqb2luLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gcGF0aCAtIEpvaW4gcGF0aCBzZWdtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBVbnF1b3RlZCB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpLlxuICAgKi9cbiAgZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpIHtcbiAgICBjb25zdCBmdWxsUGF0aCA9IHRoaXMuX2pvaW5CYXNlUGF0aC5jb25jYXQocGF0aClcblxuICAgIHJldHVybiB0aGlzLmdldEpvaW5UYWJsZVJlZmVyZW5jZShmdWxsUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBmb3Igam9pbi5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd9IHBhdGggLSBKb2luIHBhdGggc2VnbWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVvdGVkIHRhYmxlIG5hbWUgZm9yIGpvaW4gcGF0aC5cbiAgICovXG4gIGdldFRhYmxlRm9ySm9pbiguLi5wYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY29wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvciB8IHN0cmluZyB8IHN0cmluZ1tdfSBwYXRoT3JTY29wZURlc2NyaXB0b3IgLSBTY29wZSBkZXNjcmlwdG9yIG9yIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gW21heWJlU2NvcGVEZXNjcmlwdG9yXSAtIFNjb3BlIGRlc2NyaXB0b3Igd2hlbiBwYXRoIGlzIGdpdmVuLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBTY29wZWQgcXVlcnkuXG4gICAqL1xuICBzY29wZShwYXRoT3JTY29wZURlc2NyaXB0b3IsIG1heWJlU2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgaWYgKGlzTW9kZWxTY29wZURlc2NyaXB0b3IocGF0aE9yU2NvcGVEZXNjcmlwdG9yKSAmJiAhbWF5YmVTY29wZURlc2NyaXB0b3IpIHtcbiAgICAgIHJldHVybiB0aGlzLl9hcHBseVJvb3RTY29wZShwYXRoT3JTY29wZURlc2NyaXB0b3IpXG4gICAgfVxuXG4gICAgaWYgKCFtYXliZVNjb3BlRGVzY3JpcHRvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2NvcGUocGF0aCwgZGVzY3JpcHRvcikgcmVxdWlyZXMgYSBzY29wZSBkZXNjcmlwdG9yXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGx5Sm9pblBhdGhTY29wZSh7XG4gICAgICBqb2luUGF0aDogbm9ybWFsaXplU2NvcGVQYXRoKC8qKiBAdHlwZSB7c3RyaW5nIHwgc3RyaW5nW119ICovIChwYXRoT3JTY29wZURlc2NyaXB0b3IpKSxcbiAgICAgIHNjb3BlRGVzY3JpcHRvcjogbWF5YmVTY29wZURlc2NyaXB0b3JcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcm9vdCBzY29wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gc2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgX2FwcGx5Um9vdFNjb3BlKHNjb3BlRGVzY3JpcHRvcikge1xuICAgIGlmICghaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihzY29wZURlc2NyaXB0b3IpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZSgpIGV4cGVjdHMgYSBkZXNjcmlwdG9yIHJldHVybmVkIGJ5IGRlZmluZVNjb3BlKC4uLikuc2NvcGUoLi4uKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlTW9kZWxDbGFzcyA9IGJhY2tlbmRTY29wZU1vZGVsQ2xhc3Moc2NvcGVEZXNjcmlwdG9yKVxuXG4gICAgaWYgKHNjb3BlTW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSAhPT0gdGhpcy5nZXRNb2RlbENsYXNzKCkuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFwcGx5ICR7c2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3MubmFtZX0gc2NvcGUgdG8gJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBxdWVyeWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge3RoaXMgfCB2b2lkfSAqLyAoc2NvcGVEZXNjcmlwdG9yLmNhbGxiYWNrKHtcbiAgICAgIGRyaXZlcjogdGhpcy5kcml2ZXIsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKSxcbiAgICAgIHF1ZXJ5OiB0aGlzLFxuICAgICAgdGFibGU6IHRoaXMucm9vdFRhYmxlUmVmZXJlbmNlKClcbiAgICB9LCAuLi5zY29wZURlc2NyaXB0b3Iuc2NvcGVBcmdzKSlcblxuICAgIHJldHVybiBzY29wZWRRdWVyeSB8fCB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBqb2luIHBhdGggc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbi1wYXRoIHNjb3BlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3Muam9pblBhdGggLSBKb2luIHBhdGggcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IGFyZ3Muc2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgX2FwcGx5Sm9pblBhdGhTY29wZSh7am9pblBhdGgsIHNjb3BlRGVzY3JpcHRvcn0pIHtcbiAgICBpZiAoIWlzTW9kZWxTY29wZURlc2NyaXB0b3Ioc2NvcGVEZXNjcmlwdG9yKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2NvcGUoKSBleHBlY3RzIGEgZGVzY3JpcHRvciByZXR1cm5lZCBieSBkZWZpbmVTY29wZSguLi4pLnNjb3BlKC4uLilcIilcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsSm9pblBhdGggPSB0aGlzLmdldEpvaW5CYXNlUGF0aCgpLmNvbmNhdChqb2luUGF0aClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5fcmVzb2x2ZU1vZGVsQ2xhc3NGb3JKb2luUGF0aChmdWxsSm9pblBhdGgpXG5cbiAgICBjb25zdCBzY29wZU1vZGVsQ2xhc3MgPSBiYWNrZW5kU2NvcGVNb2RlbENsYXNzKHNjb3BlRGVzY3JpcHRvcilcblxuICAgIGlmIChzY29wZU1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkgIT09IHRhcmdldE1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFwcGx5ICR7c2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3MubmFtZX0gc2NvcGUgdG8gam9pbiBwYXRoICR7ZnVsbEpvaW5QYXRoLmpvaW4oXCIuXCIpfSAoJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9KWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSB0aGlzLmJ1aWxkSm9pblNjb3BlUXVlcnkodGFyZ2V0TW9kZWxDbGFzcywgZnVsbEpvaW5QYXRoKVxuICAgIGNvbnN0IG9yaWdpbmFsSm9pbkNvdW50ID0gc2NvcGVkUXVlcnkuX2pvaW5zLmxlbmd0aFxuICAgIGNvbnN0IG9yaWdpbmFsV2hlcmVDb3VudCA9IHNjb3BlZFF1ZXJ5Ll93aGVyZXMubGVuZ3RoXG4gICAgY29uc3QgYXBwbGllZFF1ZXJ5ID0gLyoqIEB0eXBlIHt0eXBlb2Ygc2NvcGVkUXVlcnkgfCB2b2lkfSAqLyAoc2NvcGVEZXNjcmlwdG9yLmNhbGxiYWNrKHtcbiAgICAgIGRyaXZlcjogc2NvcGVkUXVlcnkuZHJpdmVyLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IFsuLi5mdWxsSm9pblBhdGhdLFxuICAgICAgcXVlcnk6IHNjb3BlZFF1ZXJ5LFxuICAgICAgdGFibGU6IHNjb3BlZFF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG4gICAgfSwgLi4uc2NvcGVEZXNjcmlwdG9yLnNjb3BlQXJncykpIHx8IHNjb3BlZFF1ZXJ5XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5LmdldEZyb21zKCkubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5nZXRGcm9tcygpLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5LmdldEdyb3VwcygpLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuZ2V0R3JvdXBzKCkubGVuZ3RoIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuZ2V0U2VsZWN0cygpLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuZ2V0U2VsZWN0cygpLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9vcmRlcnMubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5fb3JkZXJzLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9saW1pdCAhPT0gc2NvcGVkUXVlcnkuX2xpbWl0IHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX29mZnNldCAhPT0gc2NvcGVkUXVlcnkuX29mZnNldCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9wYWdlICE9PSBzY29wZWRRdWVyeS5fcGFnZSB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9wZXJQYWdlICE9PSBzY29wZWRRdWVyeS5fcGVyUGFnZSB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9kaXN0aW5jdCAhPT0gc2NvcGVkUXVlcnkuX2Rpc3RpbmN0IHx8XG4gICAgICBPYmplY3Qua2V5cyhhcHBsaWVkUXVlcnkuX3ByZWxvYWQpLmxlbmd0aCAhPT0gT2JqZWN0LmtleXMoc2NvcGVkUXVlcnkuX3ByZWxvYWQpLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSm9pbmVkLXBhdGggc2NvcGVzIG1heSBvbmx5IGFkZCB3aGVyZSguLi4pIGFuZCBqb2lucyguLi4pIGNsYXVzZXNcIilcbiAgICB9XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5Ll9qb2lucy5sZW5ndGggPiBvcmlnaW5hbEpvaW5Db3VudCkge1xuICAgICAgZm9yIChjb25zdCBqb2luIG9mIGFwcGxpZWRRdWVyeS5fam9pbnMuc2xpY2Uob3JpZ2luYWxKb2luQ291bnQpKSB7XG4gICAgICAgIGlmIChqb2luIGluc3RhbmNlb2YgSm9pbk9iamVjdCkge1xuICAgICAgICAgIHRoaXMuX2pvaW5zLnB1c2gobmV3IEpvaW5PYmplY3Qoam9pbi5vYmplY3QsIGZ1bGxKb2luUGF0aCkpXG4gICAgICAgIH0gZWxzZSBpZiAoam9pbiBpbnN0YW5jZW9mIEpvaW5QbGFpbikge1xuICAgICAgICAgIHRoaXMuX2pvaW5zLnB1c2goam9pbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLl9qb2lucy5wdXNoKGpvaW4pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5Ll93aGVyZXMubGVuZ3RoID4gb3JpZ2luYWxXaGVyZUNvdW50KSB7XG4gICAgICB0aGlzLl93aGVyZXMucHVzaCguLi5hcHBsaWVkUXVlcnkuX3doZXJlcy5zbGljZShvcmlnaW5hbFdoZXJlQ291bnQpKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBqb2luIHNjb3BlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gam9pblBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2NvcGVkIGpvaW4gcXVlcnkuXG4gICAqL1xuICBidWlsZEpvaW5TY29wZVF1ZXJ5KHRhcmdldE1vZGVsQ2xhc3MsIGpvaW5QYXRoKSB7XG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAoXG4gICAgICB0aGlzLl9vcGVyYXRpb25cbiAgICAgICAgPyB0aGlzLl9vcGVyYXRpb24uZm9yTW9kZWwodGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgICAgOiB0YXJnZXRNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG4gICAgKVxuXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5UcmFja2VyID0gdGhpcy5fam9pblRyYWNrZXJcbiAgICBzY29wZWRRdWVyeS5fam9pbkJhc2VQYXRoID0gam9pblBhdGhcbiAgICBzY29wZWRRdWVyeS5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gdHJ1ZVxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95IGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3lBbGwoKSB7XG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IHRoaXMudG9BcnJheSgpXG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgYnVsayBVUERBVEUgb24gYWxsIHJvd3MgbWF0Y2hpbmcgdGhlIHF1ZXJ5J3MgV0hFUkVcbiAgICogY2xhdXNlLiBCeXBhc3NlcyBtb2RlbCBsaWZlY3ljbGUgY2FsbGJhY2tzIOKAlCB1c2UgdGhpcyBmb3JcbiAgICogZWZmaWNpZW50IGJhdGNoIHVwZGF0ZXMgd2hlcmUgcGVyLXJvdyBob29rcyBhcmVuJ3QgbmVlZGVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZXMg4oaSIHZhbHVlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdXBkYXRlIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZUFsbChkYXRhKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5kcml2ZXJcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhkYXRhKVxuXG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHNldENvbHMgPSBlbnRyaWVzLm1hcCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGtleSlcbiAgICAgIGNvbnN0IHF1b3RlZCA9IHZhbHVlID09PSBudWxsID8gXCJOVUxMXCIgOiBkcml2ZXIucXVvdGUodmFsdWUpXG5cbiAgICAgIHJldHVybiBgJHtkcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9ID0gJHtxdW90ZWR9YFxuICAgIH0pLmpvaW4oXCIsIFwiKVxuXG4gICAgY29uc3Qgam9pbnNTcWwgPSBuZXcgSm9pbnNQYXJzZXIoe3ByZXR0eTogZmFsc2UsIHF1ZXJ5OiB0aGlzfSkudG9TcWwoKVxuICAgIGNvbnN0IHdoZXJlU3FsID0gbmV3IFdoZXJlUGFyc2VyKHtwcmV0dHk6IGZhbHNlLCBxdWVyeTogdGhpc30pLnRvU3FsKClcbiAgICBsZXQgc3FsXG5cbiAgICBpZiAoam9pbnNTcWwubGVuZ3RoID4gMCkge1xuICAgICAgLy8gVXNlIGEgc3VicXVlcnkgZm9yIGNyb3NzLWRyaXZlciBjb21wYXRpYmlsaXR5IChTUUxpdGVcbiAgICAgIC8vIGRvZXNuJ3Qgc3VwcG9ydCBVUERBVEUgLi4uIEpPSU4pLlxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleSh0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCksIGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9LnVwZGF0ZUFsbCgpIHdpdGggam9pbnNgKVxuICAgICAgY29uc3QgcGsgPSBkcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleSlcbiAgICAgIGNvbnN0IHF0ID0gZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKVxuXG4gICAgICBzcWwgPSBgVVBEQVRFICR7cXR9IFNFVCAke3NldENvbHN9IFdIRVJFICR7cGt9IElOIChTRUxFQ1QgJHtxdH0uJHtwa30gRlJPTSAke3F0fSR7am9pbnNTcWx9JHt3aGVyZVNxbH0pYFxuICAgIH0gZWxzZSB7XG4gICAgICBzcWwgPSBgVVBEQVRFICR7ZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX0gU0VUICR7c2V0Q29sc30ke3doZXJlU3FsfWBcbiAgICB9XG5cbiAgICBhd2FpdCBkcml2ZXIucXVlcnkoc3FsLCB7bG9nTmFtZTogdGhpcy5xdWVyeUxvZ05hbWUoXCJVcGRhdGUgQWxsXCIpLCBzaWduYWw6IHRoaXMuX3NpZ25hbH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSByZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluZC5cbiAgICovXG4gIGFzeW5jIGZpbmQocmVjb3JkSWQpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHt7W2tleTogc3RyaW5nXTogbnVtYmVyIHwgc3RyaW5nfX0gKi9cbiAgICBjb25zdCBjb25kaXRpb25zID0ge31cblxuICAgIE9iamVjdC5hc3NpZ24oY29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCksIHJlY29yZElkKSlcblxuICAgIGNvbnN0IG5ld1F1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuY2xvbmUoKSlcblxuICAgIG5ld1F1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG5cbiAgICBjb25zdCByZWNvcmQgPSAoYXdhaXQgbmV3UXVlcnkuZmlyc3QoKSlcblxuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICB0aHJvdyBuZXcgUmVjb3JkTm90Rm91bmRFcnJvcihgQ291bGRuJ3QgZmluZCAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IHdpdGggJyR7dGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpfSc9JHtKU09OLnN0cmluZ2lmeShyZWNvcmRJZCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5LlxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkuXG4gICAqL1xuICBhc3luYyBmaW5kQnkoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IG5ld1F1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuY2xvbmUoKSlcblxuICAgIG5ld1F1ZXJ5LndoZXJlKGNvbmRpdGlvbnMpXG5cbiAgICByZXR1cm4gYXdhaXQgbmV3UXVlcnkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7KGFyZzogSW5zdGFuY2VUeXBlPE1DPikgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBjcmVhdGUgYnkuXG4gICAqL1xuICBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuXG4gICAgaWYgKHJlY29yZC5pc05ld1JlY29yZCgpKSB7XG4gICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBieSBvciBmYWlsLlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCB0aGlzLmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgaWYgKCFyZWNvcmQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBub3QgZm91bmRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsoYXJnOiBJbnN0YW5jZVR5cGU8TUM+KSA9PiB2b2lkfSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG9yIGluaXRpYWxpemUgYnkuXG4gICAqL1xuICBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCB0aGlzLmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgaWYgKHJlY29yZCkgcmV0dXJuIHJlY29yZFxuXG4gICAgY29uc3QgbmV3UmVjb3JkID0gdGhpcy5idWlsZChjb25kaXRpb25zKVxuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhuZXdSZWNvcmQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJlY29yZCBvd25lZCBieSB0aGUgcXVlcnkncyBvcGVyYXRpb24sIHdoZW4gcHJlc2VudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxNQz59IC0gQnVpbHQgcmVjb3JkLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IHt9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8TUM+fSAqLyAobmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcykpXG5cbiAgICBpZiAodGhpcy5fb3BlcmF0aW9uKSB0aGlzLl9vcGVyYXRpb24uYmluZFJlY29yZChyZWNvcmQpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJlY29yZCBvd25lZCBieSB0aGUgcXVlcnkncyBvcGVyYXRpb24sIHdoZW4gcHJlc2VudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gQ3JlYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoYXR0cmlidXRlcyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVjb3JkID0gdGhpcy5idWlsZChhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqXG4gICAqIEFuIGV4cGxpY2l0bHkgc2V0IG9yZGVyIGlzIHByZXNlcnZlZDsgdGhlIGRldGVybWluaXN0aWMgaWRlbnRpdHkgb3JkZXIgaXNcbiAgICogb25seSBhcHBsaWVkIGFzIGEgZmFsbGJhY2sgd2hlbiBubyBvcmRlciB3YXMgc2V0LCBzbyBgTElNSVQgMWAgbmV2ZXJcbiAgICogcmV0dXJucyBhbiBhcmJpdHJhcnkgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlyc3QuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IHRoaXMuY2xvbmUoKS5saW1pdCgxKVxuXG4gICAgaWYgKG5ld1F1ZXJ5LmdldE9yZGVycygpLmxlbmd0aCA9PSAwKSBuZXdRdWVyeS5yZW9yZGVyKHRoaXMuX2RlZmF1bHRJZGVudGl0eU9yZGVyKFwiQVNDXCIpKVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IG5ld1F1ZXJ5LnRvQXJyYXkoKVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbMF0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICpcbiAgICogQW4gZXhwbGljaXRseSBzZXQgb3JkZXIgaXMgcHJlc2VydmVkIGFuZCByZWFkIGZyb20gaXRzIGVuZDsgdGhlXG4gICAqIGRldGVybWluaXN0aWMgaWRlbnRpdHkgb3JkZXIgaXMgb25seSBhcHBsaWVkIGFzIGEgZmFsbGJhY2sgd2hlbiBubyBvcmRlclxuICAgKiB3YXMgc2V0LiBUaGUgY2xvbmUgc2hhcmVzIGl0cyBvcmRlciBpbnN0YW5jZXMgd2l0aCB0aGUgc291cmNlIHF1ZXJ5LCBzb1xuICAgKiB0aGUgZXhwbGljaXQgb3JkZXJzIGFyZSByZXBsYWNlZCBieSBpbmRlcGVuZGVudCByZXZlcnNlZCBjb3BpZXMgaW5zdGVhZFxuICAgKiBvZiBtdXRhdGluZyB0aGUgc2hhcmVkIG9uZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgYXN5bmMgbGFzdCgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IHRoaXMuY2xvbmUoKS5saW1pdCgxKVxuXG4gICAgaWYgKG5ld1F1ZXJ5LmdldE9yZGVycygpLmxlbmd0aCA9PSAwKSB7XG4gICAgICBuZXdRdWVyeS5yZW9yZGVyKHRoaXMuX2RlZmF1bHRJZGVudGl0eU9yZGVyKFwiREVTQ1wiKSlcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgb3JkZXJzID0gbmV3UXVlcnkuZ2V0T3JkZXJzKClcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvcmRlcnMubGVuZ3RoOyBpICs9IDEpIG9yZGVyc1tpXSA9IG9yZGVyc1tpXS5yZXZlcnNlZENvcHkoKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBuZXdRdWVyeS50b0FycmF5KClcblxuICAgIHJldHVybiByZXN1bHRzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGRldGVybWluaXN0aWMgZGVmYXVsdCBvcmRlciBmb3IgdGhlIG1vZGVsIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge1wiQVNDXCIgfCBcIkRFU0NcIn0gZGlyZWN0aW9uIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIG9yZGVyIGV4cHJlc3Npb24uXG4gICAqL1xuICBfZGVmYXVsdElkZW50aXR5T3JkZXIoZGlyZWN0aW9uKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3Qgb3JkZXJhYmxlQ29sdW1ucyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW01vZGVsQ2xhc3Mub3JkZXJhYmxlQ29sdW1uKCldXG5cbiAgICByZXR1cm4gb3JkZXJhYmxlQ29sdW1uc1xuICAgICAgLm1hcCgoY29sdW1uKSA9PiBgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKE1vZGVsQ2xhc3MudGFibGVOYW1lKCkpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbil9ICR7ZGlyZWN0aW9ufWApXG4gICAgICAuam9pbihcIiwgXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBwcmVsb2FkLlxuICAgKi9cbiAgcHJlbG9hZChkYXRhKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkUmVjb3JkKGRhdGEpXG4gICAgaW5jb3Jwb3JhdGUodGhpcy5fcHJlbG9hZCwgbm9ybWFsaXplZFByZWxvYWQpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBxdWVyeSByZXN1bHRzIGludG8gbW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxJbnN0YW5jZVR5cGU8TUM+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IG1vZGVscyA9IFtdXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMucmVzdWx0cygpXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHNlbGVjdCBvZiB0aGlzLmdldFNlbGVjdHMoKSkge1xuICAgICAgY29uc3QgYWxpYXMgPSBzZWxlY3QuZ2V0QWxpYXModGhpcy5kcml2ZXIpXG5cbiAgICAgIGlmIChhbGlhcykgc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzLmFkZChhbGlhcylcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBjb25zdCBtb2RlbCA9IHRoaXMuYnVpbGQoKVxuXG4gICAgICBtb2RlbC5sb2FkRXhpc3RpbmdSZWNvcmQocmVzdWx0LCBzZWxlY3RlZEF0dHJpYnV0ZUFsaWFzZXMpXG4gICAgICBtb2RlbHMucHVzaChtb2RlbClcbiAgICB9XG5cbiAgICAvLyBTaGFyZSBhIHNpbmdsZSBjb2hvcnQgcmVmZXJlbmNlIGFjcm9zcyBldmVyeSBzaWJsaW5nIHJlY29yZCBzbyB0aGF0XG4gICAgLy8gYXV0by1wcmVsb2FkIGNhbiBiYXRjaCBsYXp5IHJlbGF0aW9uc2hpcCBhY2Nlc3MgbGF0ZXIuXG4gICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcbiAgICAgIG1vZGVsLl9sb2FkQ29ob3J0ID0gbW9kZWxzXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3ByZWxvYWQpLmxlbmd0aCA+IDAgJiYgbW9kZWxzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHByZWxvYWRlciA9IG5ldyBQcmVsb2FkZXIoe1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICAgIG1vZGVscyxcbiAgICAgICAgcHJlbG9hZDogdGhpcy5fcHJlbG9hZCxcbiAgICAgICAgcHJlbG9hZFNlbGVjdHM6IHRoaXMuX3ByZWxvYWRTZWxlY3RzLFxuICAgICAgICBwcmVsb2FkU2VsZWN0c0V4dHJhOiB0aGlzLl9wcmVsb2FkU2VsZWN0c0V4dHJhXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCBwcmVsb2FkZXIucnVuKClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fd2l0aENvdW50Lmxlbmd0aCA+IDAgJiYgbW9kZWxzLmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHJ1bldpdGhDb3VudCh7XG4gICAgICAgIGVudHJpZXM6IHRoaXMuX3dpdGhDb3VudCxcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICBtb2RlbHNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3F1ZXJ5RGF0YS5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBydW5RdWVyeURhdGEoe1xuICAgICAgICBlbnRyaWVzOiB0aGlzLl9xdWVyeURhdGEsXG4gICAgICAgIHJvb3RNb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICAgIHJvb3RNb2RlbHM6IG1vZGVsc1xuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgcXVlcnkgcmVzdWx0cyB0byBhcnJheSBvZiBtb2RlbCBpbnN0YW5jZXNcbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8SW5zdGFuY2VUeXBlPE1DPj4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFycmF5LlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQbHVja3Mgb25lIG9yIG1vcmUgY29sdW1ucyBkaXJlY3RseSBmcm9tIHRoZSBkYXRhYmFzZSB3aXRob3V0IGluc3RhbnRpYXRpbmcgbW9kZWxzLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ3xzdHJpbmdbXX0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBwbHVjay5cbiAgICovXG4gIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBmbGF0Q29sdW1ucyA9IGNvbHVtbnMuZmxhdCgpXG5cbiAgICBpZiAoZmxhdENvbHVtbnMubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb2x1bW5zIGdpdmVuIHRvIHBsdWNrXCIpXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0YWJsZU5hbWUgPSBtb2RlbENsYXNzLnRhYmxlTmFtZSgpXG4gICAgY29uc3QgYXR0cmlidXRlTWFwID0gbW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGZsYXRDb2x1bW5zLm1hcCgoY29sdW1uKSA9PiBhdHRyaWJ1dGVNYXBbY29sdW1uXSB8fCBjb2x1bW4pXG5cbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLmNsb25lKCkpXG5cbiAgICBxdWVyeS5fcHJlbG9hZCA9IHt9XG4gICAgcXVlcnkuX3NlbGVjdHMgPSBbXVxuXG4gICAgY29sdW1uTmFtZXMuZm9yRWFjaCgoY29sdW1uTmFtZSkgPT4ge1xuICAgICAgY29uc3Qgc2VsZWN0U3FsID0gYCR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgICAgcXVlcnkuc2VsZWN0KHNlbGVjdFNxbClcbiAgICB9KVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5Ll9leGVjdXRlUXVlcnkoe2xvZ05hbWU6IHF1ZXJ5LnF1ZXJ5TG9nTmFtZShcIlBsdWNrXCIpfSlcblxuICAgIGlmIChjb2x1bW5OYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IFtjb2x1bW5OYW1lXSA9IGNvbHVtbk5hbWVzXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpW2NvbHVtbk5hbWVdKVxuICAgIH1cblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBjb25zdCByb3dIYXNoID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgIHJldHVybiBjb2x1bW5OYW1lcy5tYXAoKGNvbHVtbk5hbWUpID0+IHJvd0hhc2hbY29sdW1uTmFtZV0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuV2hlcmVBcmd1bWVudFR5cGV9IHdoZXJlIC0gV2hlcmUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSBUaGlzIHF1ZXJ5IGluc3RhbmNlXG4gICAqL1xuICB3aGVyZSh3aGVyZSkge1xuICAgIGlmICh0eXBlb2Ygd2hlcmUgPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHN1cGVyLndoZXJlKHdoZXJlKVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KHdoZXJlKSkge1xuICAgICAgY29uc3Qge3Jlc29sdmVkSGFzaCwgZmFsbGJhY2tIYXNofSA9IHNwbGl0V2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuICAgICAgY29uc3Qgam9pbk9iamVjdCA9IGJ1aWxkSm9pbk9iamVjdEZyb21XaGVyZUhhc2goe2hhc2g6IHdoZXJlLCBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKX0pXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuam9pbnMoam9pbk9iamVjdClcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKHJlc29sdmVkSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBxdWFsaWZ5QmFzZVRhYmxlID0gdGhpcy5nZXRGb3JjZVF1YWxpZnlCYXNlVGFibGUoKSB8fCBPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwXG4gICAgICAgIHRoaXMuX3doZXJlcy5wdXNoKG5ldyBXaGVyZU1vZGVsQ2xhc3NIYXNoKHtcbiAgICAgICAgICBoYXNoOiByZXNvbHZlZEhhc2gsXG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCksXG4gICAgICAgICAgcXVhbGlmeUJhc2VUYWJsZSxcbiAgICAgICAgICBxdWVyeTogdGhpc1xuICAgICAgICB9KSlcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGZhbGxiYWNrSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBzdXBlci53aGVyZShmYWxsYmFja0hhc2gpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHR5cGUgb2Ygd2hlcmU6ICR7dHlwZW9mIHdoZXJlfSAoJHt3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guIFN1cHBvcnRzIGBzYCBrZXkgZm9yIHNvcnRpbmcgKGUuZy4sIGB7czogXCJuYW1lIGFzY1wifWApLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIFJhbnNhY2sgZmlsdGVycyBhbmQgc29ydCBhcHBsaWVkLlxuICAgKi9cbiAgcmFuc2FjayhwYXJhbXMpIHtcbiAgICBjb25zdCB7cywgLi4uZmlsdGVyUGFyYW1zfSA9IHBhcmFtc1xuICAgIGNvbnN0IGdyb3VwID0gbm9ybWFsaXplUmFuc2Fja0dyb3VwKHRoaXMuZ2V0TW9kZWxDbGFzcygpLCBmaWx0ZXJQYXJhbXMpXG5cbiAgICBhcHBseVJhbnNhY2tHcm91cCh7Z3JvdXAsIHF1ZXJ5OiB0aGlzfSlcblxuICAgIGlmICh0eXBlb2YgcyA9PT0gXCJzdHJpbmdcIiAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzb3J0cyA9IHBhcnNlUmFuc2Fja1NvcnQodGhpcy5nZXRNb2RlbENsYXNzKCksIHMpXG5cbiAgICAgIGZvciAoY29uc3Qgc29ydERlZiBvZiBzb3J0cykge1xuICAgICAgICB0aGlzLm9yZGVyKHtjb2x1bW46IHNvcnREZWYuYXR0cmlidXRlLCBkaXJlY3Rpb246IHNvcnREZWYuZGlyZWN0aW9ufSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUgbm90LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuV2hlcmVBcmd1bWVudFR5cGV9IHdoZXJlIC0gV2hlcmUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSBUaGlzIHF1ZXJ5IGluc3RhbmNlXG4gICAqL1xuICB3aGVyZU5vdCh3aGVyZSkge1xuICAgIGlmICh0eXBlb2Ygd2hlcmUgPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHN1cGVyLndoZXJlTm90KHdoZXJlKVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KHdoZXJlKSkge1xuICAgICAgY29uc3Qge3Jlc29sdmVkSGFzaCwgZmFsbGJhY2tIYXNofSA9IHNwbGl0V2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuICAgICAgY29uc3Qgam9pbk9iamVjdCA9IGJ1aWxkSm9pbk9iamVjdEZyb21XaGVyZUhhc2goe2hhc2g6IHdoZXJlLCBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKX0pXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuam9pbnMoam9pbk9iamVjdClcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKHJlc29sdmVkSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBxdWFsaWZ5QmFzZVRhYmxlID0gdGhpcy5nZXRGb3JjZVF1YWxpZnlCYXNlVGFibGUoKSB8fCBPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwXG4gICAgICAgIHRoaXMuX3doZXJlcy5wdXNoKG5ldyBXaGVyZU5vdChuZXcgV2hlcmVNb2RlbENsYXNzSGFzaCh7XG4gICAgICAgICAgaGFzaDogcmVzb2x2ZWRIYXNoLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLFxuICAgICAgICAgIHF1YWxpZnlCYXNlVGFibGUsXG4gICAgICAgICAgcXVlcnk6IHRoaXNcbiAgICAgICAgfSkpKVxuICAgICAgfVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZmFsbGJhY2tIYXNoKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHN1cGVyLndoZXJlTm90KGZhbGxiYWNrSGFzaClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdHlwZSBvZiB3aGVyZTogJHt0eXBlb2Ygd2hlcmV9ICgke3doZXJlLmNvbnN0cnVjdG9yLm5hbWV9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBsb2cgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIFF1ZXJ5IG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdWVyeSBsb2cgbmFtZS5cbiAgICovXG4gIHF1ZXJ5TG9nTmFtZShvcGVyYXRpb24pIHtcbiAgICByZXR1cm4gYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gJHtvcGVyYXRpb259YFxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIHRoaXMgcXVlcnkgYXMgYSBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRGVjbGFyZWQgc2NvcGUgYW5kIHB1bGwgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luYygpIHtcbiAgICByZXR1cm4gYXdhaXQgY3VycmVudFN5bmNDbGllbnQoKS5zeW5jKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogRGVhY3RpdmF0ZXMgdGhpcyBxdWVyeSdzIHN5bmMgc2NvcGUgb24gdGhlIGN1cnJlbnQgc3luYyBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjb3BlIGlzIGRlYWN0aXZhdGVkLlxuICAgKi9cbiAgYXN5bmMgdW5zeW5jKCkge1xuICAgIGF3YWl0IGN1cnJlbnRTeW5jQ2xpZW50KCkudW5zeW5jKHRoaXMpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFwcGx5IHJhbnNhY2sgZ3JvdXAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBhcmdzLmdyb3VwIC0gTm9ybWFsaXplZCBSYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlSYW5zYWNrR3JvdXAoe2dyb3VwLCBxdWVyeX0pIHtcbiAgY29uc3Qgd2hlcmUgPSBidWlsZFJhbnNhY2tHcm91cFdoZXJlKHtncm91cCwgcXVlcnl9KVxuXG4gIGlmICh3aGVyZSkge1xuICAgIHF1ZXJ5Ll93aGVyZXMucHVzaCh3aGVyZSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBncm91cCB3aGVyZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrR3JvdXB9IGFyZ3MuZ3JvdXAgLSBOb3JtYWxpemVkIFJhbnNhY2sgZ3JvdXAuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3doZXJlLWJhc2UuanNcIikuZGVmYXVsdCB8IG51bGx9IC0gQ29tYmluZWQgd2hlcmUgY2xhdXNlLlxuICovXG5mdW5jdGlvbiBidWlsZFJhbnNhY2tHcm91cFdoZXJlKHtncm91cCwgcXVlcnl9KSB7XG4gIC8qKlxuICAgKiBXaGVyZXMuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL3doZXJlLWJhc2UuanNcIikuZGVmYXVsdFtdfSAqL1xuICBjb25zdCB3aGVyZXMgPSBbXVxuXG4gIGZvciAoY29uc3QgY29uZGl0aW9uIG9mIGdyb3VwLmNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkUmFuc2Fja0NvbmRpdGlvbldoZXJlKHtjb25kaXRpb24sIHF1ZXJ5fSlcblxuICAgIGlmICh3aGVyZSkgd2hlcmVzLnB1c2god2hlcmUpXG4gIH1cblxuICBmb3IgKGNvbnN0IGdyb3VwaW5nIG9mIGdyb3VwLmdyb3VwaW5ncykge1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXA6IGdyb3VwaW5nLCBxdWVyeX0pXG5cbiAgICBpZiAod2hlcmUpIHdoZXJlcy5wdXNoKHdoZXJlKVxuICB9XG5cbiAgaWYgKHdoZXJlcy5sZW5ndGggPCAxKSByZXR1cm4gbnVsbFxuICBpZiAod2hlcmVzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHdoZXJlc1swXVxuXG4gIHJldHVybiBuZXcgV2hlcmVDb21iaW5hdG9yKHtcbiAgICBjb21iaW5hdG9yOiBncm91cC5jb21iaW5hdG9yLFxuICAgIHF1ZXJ5LFxuICAgIHdoZXJlc1xuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBjb25kaXRpb24gd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gYXJncy5jb25kaXRpb24gLSBOb3JtYWxpemVkIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIENvbmRpdGlvbiB3aGVyZSBjbGF1c2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0NvbmRpdGlvbldoZXJlKHtjb25kaXRpb24sIHF1ZXJ5fSkge1xuICAvKipcbiAgICogV2hlcmVzLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgY29uc3Qgd2hlcmVzID0gW11cblxuICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBjb25kaXRpb24uYXR0cmlidXRlcykge1xuICAgIHdoZXJlcy5wdXNoKGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZVdoZXJlKHthdHRyaWJ1dGUsIGNvbmRpdGlvbiwgcXVlcnl9KSlcbiAgfVxuXG4gIGlmICh3aGVyZXMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcbiAgaWYgKHdoZXJlcy5sZW5ndGggPT09IDEpIHJldHVybiB3aGVyZXNbMF1cblxuICByZXR1cm4gbmV3IFdoZXJlQ29tYmluYXRvcih7XG4gICAgY29tYmluYXRvcjogY29uZGl0aW9uLmNvbWJpbmF0b3IsXG4gICAgcXVlcnksXG4gICAgd2hlcmVzXG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBidWlsZCByYW5zYWNrIGF0dHJpYnV0ZSB3aGVyZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gYXJncy5jb25kaXRpb24gLSBOb3JtYWxpemVkIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHR9IC0gQXR0cmlidXRlIHdoZXJlIGNsYXVzZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSYW5zYWNrQXR0cmlidXRlV2hlcmUoe2F0dHJpYnV0ZSwgY29uZGl0aW9uLCBxdWVyeX0pIHtcbiAgY29uc3QgaGFzaCA9IGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZUhhc2goe2F0dHJpYnV0ZSwgY29uZGl0aW9ufSlcbiAgY29uc3Qgam9pbk9iamVjdCA9IGJ1aWxkSm9pbk9iamVjdEZyb21XaGVyZUhhc2goe2hhc2gsIG1vZGVsQ2xhc3M6IHF1ZXJ5LmdldE1vZGVsQ2xhc3MoKX0pXG5cbiAgaWYgKE9iamVjdC5rZXlzKGpvaW5PYmplY3QpLmxlbmd0aCA+IDApIHtcbiAgICBxdWVyeS5qb2lucyhqb2luT2JqZWN0KVxuICB9XG5cbiAgY29uc3Qgd2hlcmUgPSBuZXcgV2hlcmVNb2RlbENsYXNzSGFzaCh7XG4gICAgaGFzaCxcbiAgICBtb2RlbENsYXNzOiBxdWVyeS5nZXRNb2RlbENsYXNzKCksXG4gICAgcXVhbGlmeUJhc2VUYWJsZTogdHJ1ZSxcbiAgICBxdWVyeVxuICB9KVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9lcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibm90X2luXCIpIHtcbiAgICByZXR1cm4gbmV3IFdoZXJlTm90KHdoZXJlKVxuICB9XG5cbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibnVsbFwiICYmICFjb25kaXRpb24udmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IFdoZXJlTm90KHdoZXJlKVxuICB9XG5cbiAgcmV0dXJuIHdoZXJlXG59XG5cbi8qKlxuICogUnVucyBidWlsZCByYW5zYWNrIGF0dHJpYnV0ZSBoYXNoLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tBdHRyaWJ1dGV9IGFyZ3MuYXR0cmlidXRlIC0gTm9ybWFsaXplZCBSYW5zYWNrIGF0dHJpYnV0ZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQ29uZGl0aW9ufSBhcmdzLmNvbmRpdGlvbiAtIE5vcm1hbGl6ZWQgUmFuc2FjayBjb25kaXRpb24uXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE5lc3RlZCBoYXNoIHN1aXRhYmxlIGZvciBxdWVyeSB3aGVyZSBub2Rlcy5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSYW5zYWNrQXR0cmlidXRlSGFzaCh7YXR0cmlidXRlLCBjb25kaXRpb259KSB7XG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcImVxXCIgfHwgY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJpblwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibm90X2VxXCIgfHwgY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJub3RfaW5cIikge1xuICAgIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tIYXNoKHthdHRyaWJ1dGUsIHZhbHVlOiBjb25kaXRpb24udmFsdWV9KVxuICB9XG5cbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibnVsbFwiKSB7XG4gICAgcmV0dXJuIGJ1aWxkTmVzdGVkUmFuc2Fja0hhc2goe2F0dHJpYnV0ZSwgdmFsdWU6IG51bGx9KVxuICB9XG5cbiAgcmV0dXJuIGJ1aWxkTmVzdGVkUmFuc2Fja1R1cGxlSGFzaCh7XG4gICAgYXR0cmlidXRlLFxuICAgIG9wZXJhdG9yOiByYW5zYWNrVHVwbGVPcGVyYXRvcihjb25kaXRpb24ucHJlZGljYXRlKSxcbiAgICB2YWx1ZTogcmFuc2Fja1R1cGxlVmFsdWUoY29uZGl0aW9uKVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgbmVzdGVkIHJhbnNhY2sgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gRmluYWwgdmFsdWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE5lc3RlZCBoYXNoIHN1aXRhYmxlIGZvciBxdWVyeSB3aGVyZSBub2Rlcy5cbiAqL1xuZnVuY3Rpb24gYnVpbGROZXN0ZWRSYW5zYWNrSGFzaCh7YXR0cmlidXRlLCB2YWx1ZX0pIHtcbiAgLyoqXG4gICAqIEhhc2guXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGxldCBoYXNoID0ge1thdHRyaWJ1dGUuYXR0cmlidXRlTmFtZV06IHZhbHVlfVxuXG4gIGZvciAobGV0IGluZGV4ID0gYXR0cmlidXRlLnBhdGgubGVuZ3RoIC0gMTsgaW5kZXggPj0gMDsgaW5kZXggLT0gMSkge1xuICAgIGhhc2ggPSB7W2F0dHJpYnV0ZS5wYXRoW2luZGV4XV06IGhhc2h9XG4gIH1cblxuICByZXR1cm4gaGFzaFxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgbmVzdGVkIHJhbnNhY2sgdHVwbGUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge1wiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gYXJncy5vcGVyYXRvciAtIFR1cGxlIG9wZXJhdG9yLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIEZpbmFsIHZhbHVlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgdHVwbGUgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkud2hlcmUuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTmVzdGVkUmFuc2Fja1R1cGxlSGFzaCh7YXR0cmlidXRlLCBvcGVyYXRvciwgdmFsdWV9KSB7XG4gIC8qKlxuICAgKiBIYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgaGFzaCA9IHtcbiAgICBbYXR0cmlidXRlLmF0dHJpYnV0ZU5hbWVdOiBbW2F0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lLCBvcGVyYXRvciwgdmFsdWVdXVxuICB9XG5cbiAgZm9yIChsZXQgaW5kZXggPSBhdHRyaWJ1dGUucGF0aC5sZW5ndGggLSAxOyBpbmRleCA+PSAwOyBpbmRleCAtPSAxKSB7XG4gICAgaGFzaCA9IHtbYXR0cmlidXRlLnBhdGhbaW5kZXhdXTogaGFzaH1cbiAgfVxuXG4gIHJldHVybiBoYXNoXG59XG5cbi8qKlxuICogUnVucyByYW5zYWNrIHR1cGxlIG9wZXJhdG9yLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tQcmVkaWNhdGV9IHByZWRpY2F0ZSAtIFJhbnNhY2sgcHJlZGljYXRlLlxuICogQHJldHVybnMge1wiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gLSBRdWVyeSB0dXBsZSBvcGVyYXRvci5cbiAqL1xuZnVuY3Rpb24gcmFuc2Fja1R1cGxlT3BlcmF0b3IocHJlZGljYXRlKSB7XG4gIGlmIChwcmVkaWNhdGUgPT09IFwiZ3RcIiB8fCBwcmVkaWNhdGUgPT09IFwiZ3RlcVwiIHx8IHByZWRpY2F0ZSA9PT0gXCJsdFwiIHx8IHByZWRpY2F0ZSA9PT0gXCJsdGVxXCIpIHtcbiAgICByZXR1cm4gcHJlZGljYXRlXG4gIH1cblxuICByZXR1cm4gXCJsaWtlXCJcbn1cblxuLyoqXG4gKiBSdW5zIHJhbnNhY2sgdHVwbGUgdmFsdWUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gY29uZGl0aW9uIC0gUmFuc2FjayBjb25kaXRpb24uXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gUXVlcnkgdHVwbGUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHJhbnNhY2tUdXBsZVZhbHVlKGNvbmRpdGlvbikge1xuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJjb250XCIpIHJldHVybiBgJSR7Y29uZGl0aW9uLnZhbHVlfSVgXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcInN0YXJ0XCIpIHJldHVybiBgJHtjb25kaXRpb24udmFsdWV9JWBcbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiZW5kXCIpIHJldHVybiBgJSR7Y29uZGl0aW9uLnZhbHVlfWBcblxuICByZXR1cm4gY29uZGl0aW9uLnZhbHVlXG59XG5cbi8qKlxuICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gVGhlIHJlbGF0aW9uc2hpcC5cbiAqL1xuZnVuY3Rpb24gZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIGNvbHVtbiBuYW1lLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBBdHRyaWJ1dGUgb3IgY29sdW1uIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSByZXNvbHZlZCBjb2x1bW4gbmFtZS5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUNvbHVtbk5hbWUobW9kZWxDbGFzcywga2V5KSB7XG4gIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgaWYgKGF0dHJpYnV0ZU1hcFtrZXldKSByZXR1cm4gYXR0cmlidXRlTWFwW2tleV1cblxuICBjb25zdCBjb2x1bW5NYXAgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICBjb25zdCB1bmRlcnNjb3JlZCA9IGluZmxlY3Rpb24udW5kZXJzY29yZShrZXkpXG5cbiAgcmV0dXJuIGNvbHVtbk1hcFtrZXldIHx8IGNvbHVtbk1hcFt1bmRlcnNjb3JlZF0gfHwgdW5kZWZpbmVkXG59XG5cbi8qKlxuICogUnVucyBzcGxpdCB3aGVyZSBoYXNoLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuaGFzaCAtIFdoZXJlIGhhc2guXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7e3Jlc29sdmVkSGFzaDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBmYWxsYmFja0hhc2g6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IC0gU3BsaXQgaGFzaGVzLlxuICovXG5mdW5jdGlvbiBzcGxpdFdoZXJlSGFzaCh7aGFzaCwgbW9kZWxDbGFzc30pIHtcbiAgLyoqXG4gICAqIFJlc29sdmVkIGhhc2guXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHJlc29sdmVkSGFzaCA9IHt9XG4gIC8qKlxuICAgKiBGYWxsYmFjayBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBmYWxsYmFja0hhc2ggPSB7fVxuXG4gIGZvciAoY29uc3Qga2V5IGluIGhhc2gpIHtcbiAgICBjb25zdCB2YWx1ZSA9IGhhc2hba2V5XVxuICAgIGNvbnN0IGlzTmVzdGVkID0gaXNQbGFpbk9iamVjdCh2YWx1ZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBnZXRSZWxhdGlvbnNoaXBCeU5hbWUobW9kZWxDbGFzcywga2V5KVxuXG4gICAgaWYgKGlzTmVzdGVkICYmICFyZWxhdGlvbnNoaXAgJiYgcmVzb2x2ZUNvbHVtbk5hbWUobW9kZWxDbGFzcywga2V5KSkge1xuICAgICAgcmVzb2x2ZWRIYXNoW2tleV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgY29uc3QgcmF3VGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcbiAgICAgICAgaWYgKCFyYXdUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgICAgZmFsbGJhY2tIYXNoW2tleV0gPSB2YWx1ZVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuICAgICAgICBjb25zdCBuZXN0ZWRSZXN1bHQgPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogdmFsdWUsIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3N9KVxuICAgICAgICBjb25zdCBuZXN0ZWRSZXNvbHZlZEtleXMgPSBPYmplY3Qua2V5cyhuZXN0ZWRSZXN1bHQucmVzb2x2ZWRIYXNoKVxuICAgICAgICBjb25zdCBuZXN0ZWRGYWxsYmFja0tleXMgPSBPYmplY3Qua2V5cyhuZXN0ZWRSZXN1bHQuZmFsbGJhY2tIYXNoKVxuXG4gICAgICAgIGlmIChuZXN0ZWRSZXNvbHZlZEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHJlc29sdmVkSGFzaFtrZXldID0gbmVzdGVkUmVzdWx0LnJlc29sdmVkSGFzaFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5lc3RlZEZhbGxiYWNrS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgdGFibGVOYW1lID0gdGFyZ2V0TW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuXG4gICAgICAgICAgaWYgKCFmYWxsYmFja0hhc2hbdGFibGVOYW1lXSkgZmFsbGJhY2tIYXNoW3RhYmxlTmFtZV0gPSB7fVxuICAgICAgICAgIE9iamVjdC5hc3NpZ24oZmFsbGJhY2tIYXNoW3RhYmxlTmFtZV0sIG5lc3RlZFJlc3VsdC5mYWxsYmFja0hhc2gpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrSGFzaFtrZXldID0gdmFsdWVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcCAmJiBoYXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSkge1xuICAgICAgcmVzb2x2ZWRIYXNoW2tleV0gPSBub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZUNvbHVtbk5hbWUobW9kZWxDbGFzcywga2V5KVxuXG4gICAgICBpZiAoY29sdW1uTmFtZSkge1xuICAgICAgICByZXNvbHZlZEhhc2hbY29sdW1uTmFtZV0gPSB2YWx1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2tIYXNoW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7cmVzb2x2ZWRIYXNoLCBmYWxsYmFja0hhc2h9XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBqb2luIG9iamVjdCBmcm9tIHdoZXJlIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5oYXNoIC0gV2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSm9pbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkSm9pbk9iamVjdEZyb21XaGVyZUhhc2goe2hhc2gsIG1vZGVsQ2xhc3N9KSB7XG4gIC8qKlxuICAgKiBKb2luIG9iamVjdC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3Qgam9pbk9iamVjdCA9IHt9XG5cbiAgZm9yIChjb25zdCBrZXkgaW4gaGFzaCkge1xuICAgIGNvbnN0IHZhbHVlID0gaGFzaFtrZXldXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG1vZGVsQ2xhc3MsIGtleSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwKSBjb250aW51ZVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuICAgICAgaWYgKCFyYXdUYXJnZXRNb2RlbENsYXNzKSBjb250aW51ZVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuICAgICAgY29uc3QgbmVzdGVkSm9pbk9iamVjdCA9IGJ1aWxkSm9pbk9iamVjdEZyb21XaGVyZUhhc2goe2hhc2g6IHZhbHVlLCBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzfSlcblxuICAgICAgam9pbk9iamVjdFtrZXldID0gT2JqZWN0LmtleXMobmVzdGVkSm9pbk9iamVjdCkubGVuZ3RoID4gMCA/IG5lc3RlZEpvaW5PYmplY3QgOiB0cnVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChoYXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSkge1xuICAgICAgam9pbk9iamVjdFtrZXldID0gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBqb2luT2JqZWN0XG59XG5cbmNvbnN0IHJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JzID0gbmV3IFNldChbXCJlcVwiLCBcIm5vdEVxXCIsIFwiZ3RcIiwgXCJndGVxXCIsIFwibHRcIiwgXCJsdGVxXCIsIFwibGlrZVwiLCBcIj5cIiwgXCI+PVwiLCBcIjxcIiwgXCI8PVwiXSlcblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0b3IgLSBSYXcgcmVsYXRpb25zaGlwIHdoZXJlIG9wZXJhdG9yLlxuICogQHJldHVybnMge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gLSBOb3JtYWxpemVkIG9wZXJhdG9yLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yKG9wZXJhdG9yKSB7XG4gIGNvbnN0IG9wZXJhdG9yQWxpYXNlcyA9IHtcbiAgICBcIjxcIjogXCJsdFwiLFxuICAgIFwiPD1cIjogXCJsdGVxXCIsXG4gICAgXCI+XCI6IFwiZ3RcIixcbiAgICBcIj49XCI6IFwiZ3RlcVwiXG4gIH1cblxuICByZXR1cm4gLyoqIEB0eXBlIHtcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9ICovIChcbiAgICBvcGVyYXRvckFsaWFzZXNbLyoqIEB0eXBlIHtcIjxcIiB8IFwiPD1cIiB8IFwiPlwiIHwgXCI+PVwifSAqLyAob3BlcmF0b3IpXSB8fCBvcGVyYXRvclxuICApXG59XG5cbi8qKlxuICogUnVucyBpcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0dXBsZVZhbHVlIC0gQ2FuZGlkYXRlIHR1cGxlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGlzIGEgcmVsYXRpb25zaGlwIHdoZXJlIHR1cGxlLlxuICovXG5mdW5jdGlvbiBpc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZSh0dXBsZVZhbHVlKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheSh0dXBsZVZhbHVlKSB8fCB0dXBsZVZhbHVlLmxlbmd0aCA8IDMpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiB0eXBlb2YgdHVwbGVWYWx1ZVswXSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgIHR5cGVvZiB0dXBsZVZhbHVlWzFdID09PSBcInN0cmluZ1wiICYmXG4gICAgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMuaGFzKHR1cGxlVmFsdWVbMV0pXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmVsYXRpb25zaGlwIHdoZXJlIG9wZXJhdG9yIHR1cGxlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge0FycmF5PFtzdHJpbmcsIFwiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIiwgdW5rbm93bl0+fSAtIE5vcm1hbGl6ZWQgdHVwbGVzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb25zaGlwIHdoZXJlIHR1cGxlIGNvbnRhaW5lciB0eXBlOiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIsIHVua25vd25dPn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG4gICAgLyoqXG4gICAgICogQWRkIGNvbmRpdGlvbi5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25WYWx1ZSAtIENhbmRpZGF0ZSBuZXN0ZWQgY29uZGl0aW9uLlxuICAgICAqL1xuICAgIGNvbnN0IGFkZENvbmRpdGlvbiA9IChjb25kaXRpb25WYWx1ZSkgPT4ge1xuICAgICAgaWYgKGlzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKGNvbmRpdGlvblZhbHVlKSkge1xuICAgICAgICBjb25zdCB0dXBsZSA9IC8qKiBAdHlwZSB7W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIiwgdW5rbm93biwgLi4uQXJyYXk8dW5rbm93bj5dfSAqLyAoY29uZGl0aW9uVmFsdWUpXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRvciA9IG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3IodHVwbGVbMV0pXG5cbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKFtcbiAgICAgICAgICB0dXBsZVswXSxcbiAgICAgICAgICBub3JtYWxpemVkT3BlcmF0b3IsXG4gICAgICAgICAgdHVwbGVbMl1cbiAgICAgICAgXSlcblxuICAgICAgICBpZiAodHVwbGUubGVuZ3RoID4gMykge1xuICAgICAgICAgIGZvciAobGV0IGluZGV4ID0gMzsgaW5kZXggPCB0dXBsZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgICAgIGFkZENvbmRpdGlvbih0dXBsZVtpbmRleF0pXG4gICAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgY29uZGl0aW9ucyBtdXN0IGJlIHR1cGxlc1wiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY29uZGl0aW9uVmFsdWUpLmZvckVhY2goKG5lc3RlZENvbmRpdGlvblZhbHVlKSA9PiB7XG4gICAgICBhZGRDb25kaXRpb24obmVzdGVkQ29uZGl0aW9uVmFsdWUpXG4gICAgfSlcbiAgfVxuXG4gIGFkZENvbmRpdGlvbih2YWx1ZSlcblxuICBpZiAobm9ybWFsaXplZC5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiUmVsYXRpb25zaGlwIHdoZXJlIHR1cGxlIGNvbnRhaW5lciBjYW5ub3QgYmUgZW1wdHlcIilcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBoYXMgcmVsYXRpb25zaGlwIHdoZXJlIG9wZXJhdG9yIHR1cGxlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHJlbGF0aW9uc2hpcCB3aGVyZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgY2FuIGJlIG5vcm1hbGl6ZWQgdG8gcmVsYXRpb25zaGlwIHR1cGxlcy5cbiAqL1xuZnVuY3Rpb24gaGFzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh2YWx1ZSkge1xuICB0cnkge1xuICAgIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuIl19