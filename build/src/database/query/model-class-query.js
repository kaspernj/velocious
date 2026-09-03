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
        const record = this.build(attributes);
        await record.save();
        return record;
    }
    /**
     * Runs first.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the first.
     */
    async first() {
        const newQuery = this.clone().limit(1).reorder(`${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().orderableColumn())}`);
        const results = await newQuery.toArray();
        return results[0] || null;
    }
    /**
     * Runs last.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the last.
     */
    async last() {
        const primaryKey = this.getModelClass().orderableColumn();
        const tableName = this.getModelClass().tableName();
        const results = await this.clone().reorder(`${this.driver.quoteTable(tableName)}.${this.driver.quoteColumn(primaryKey)} DESC`).limit(1).toArray();
        return results[0] || null;
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
        const models = [];
        const results = await this.results();
        for (const result of results) {
            const model = this.build();
            model.loadExistingRecord(result);
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
        if (isNested) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtY2xhc3MtcXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLGlCQUFpQixDQUFBO0FBQzdDLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLG9DQUFvQyxDQUFBO0FBQ3BFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sU0FBUyxNQUFNLGdCQUFnQixDQUFBO0FBQ3RDLE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxZQUFZLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsWUFBWSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sWUFBWSxDQUFBO0FBQ3RDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sbUJBQW1CLE1BQU0scUNBQXFDLENBQUE7QUFDckUsT0FBTyxFQUFDLHFCQUFxQixFQUFFLGdCQUFnQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDOUUsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDakUsT0FBTyxFQUFDLHlCQUF5QixFQUFFLHFCQUFxQixFQUFDLE1BQU0sa0NBQWtDLENBQUE7QUFDakcsT0FBTyxlQUFlLE1BQU0sdUJBQXVCLENBQUE7QUFDbkQsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNyQyxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN6RCxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV6RDs7OztHQUlHO0FBQ0g7Ozs7R0FJRztBQUNILFNBQVMsb0JBQW9CLENBQUMsS0FBSztJQUNqQyxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUE7SUFFNUIsSUFBSSxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDeEksT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRCxJQUFJLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzVFLE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUM3QixDQUFDO0lBRUQsT0FBTyxPQUFPLENBQUE7QUFDaEIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLDRCQUE0QixDQUFDLFNBQVM7SUFDN0MsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFBO0lBRWhDLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFbkMsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxzRkFBc0YsQ0FBQyxDQUFBO0lBRXhILElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFOUMsT0FBTyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUM1QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsa0JBQWtCLENBQUMsSUFBSTtJQUM5QixJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzdCLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFBO1FBRTVFLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNmLENBQUM7SUFFRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ3pCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQTtJQUM1RCxDQUFDO0lBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUN6QixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sSUFBSSxLQUFLLENBQUMsOENBQThDLENBQUMsQ0FBQTtRQUNqRSxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFBO0FBQ2xCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxlQUFlO0lBQzdDLE1BQU0sVUFBVSxHQUFHLGVBQWUsQ0FBQyxVQUFVLENBQUE7SUFFN0MsSUFBSSxDQUFDLENBQUMsbUNBQW1DLElBQUksVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUN6RCxNQUFNLElBQUksS0FBSyxDQUFDLHFFQUFxRSxDQUFDLENBQUE7SUFDeEYsQ0FBQztJQUVELDBGQUEwRjtJQUMxRixPQUFPLDBEQUEwRCxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7QUFDaEYsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxHQUFHO0lBQ2hDOzswQ0FFc0M7SUFDdEMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO0lBRWpCLEtBQUssTUFBTSxDQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDMUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLENBQUMsQ0FBQTtJQUNyQyxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsc0JBQXNCLENBQUMsT0FBTztJQUNyQyxJQUFJLENBQUMsT0FBTztRQUFFLE9BQU8sRUFBRSxDQUFBO0lBRXZCLElBQUksT0FBTyxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDL0IsT0FBTyxFQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsSUFBSSxFQUFDLENBQUE7SUFDMUIsQ0FBQztJQUVELElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQzNCOzs4REFFc0Q7UUFDdEQsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxFQUFFLENBQUM7WUFDNUIsSUFBSSxPQUFPLEtBQUssSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDN0IsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQTtnQkFDcEIsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLGFBQWEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN6QixXQUFXLENBQUMsTUFBTSxFQUFFLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7Z0JBQ2xELFNBQVE7WUFDVixDQUFDO1lBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsT0FBTyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQ2hFLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRCxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDNUIsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsT0FBTyxPQUFPLEVBQUUsQ0FBQyxDQUFBO0lBQzVELENBQUM7SUFFRDs7MERBRXNEO0lBQ3RELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVqQixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ25ELElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDdEMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNuQixTQUFRO1FBQ1YsQ0FBQztRQUVELElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksYUFBYSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0UsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzNDLFNBQVE7UUFDVixDQUFDO1FBRUQsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsR0FBRyxLQUFLLE9BQU8sS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUN0RSxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7OztHQUdHO0FBRUg7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxxQ0FBc0MsU0FBUSxhQUFhO0lBQzlFOzs7T0FHRztJQUNILFlBQVksSUFBSTtRQUNkLE1BQU0sRUFBQyxVQUFVLEVBQUMsR0FBRyxJQUFJLENBQUE7UUFFekIsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFMUYsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ1gsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUU5Qjs7d0JBRWdCO1FBQ2hCLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBRTVCOzs4QkFFc0I7UUFDdEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQTtRQUM1QyxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxXQUFXLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDdEYsSUFBSSxDQUFDLHNCQUFzQixHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNqRSxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUE7UUFFaEM7O2dFQUV3RDtRQUN4RCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUUzRDs7Z0VBRXdEO1FBQ3hELElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO0lBQzdELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsTUFBTSxRQUFRLEdBQUcsd0RBQXdELENBQUMsQ0FBQyxJQUFJLHFDQUFxQyxDQUFDO1lBQ25ILE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUztZQUN0QixLQUFLLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7WUFDdkIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFO1lBQzdCLE1BQU0sRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztZQUN6QixLQUFLLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7WUFDdkIsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ2xCLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUMzQixNQUFNLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDcEIsTUFBTSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDO1lBQ3pCLElBQUksRUFBRSxJQUFJLENBQUMsS0FBSztZQUNoQixPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDdEIsT0FBTyxFQUFFLEVBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFDO1lBQzNCLGNBQWMsRUFBRSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO1lBQzNELG1CQUFtQixFQUFFLHFCQUFxQixDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztZQUNyRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDeEIsT0FBTyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO1lBQzNCLE1BQU0sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNwQixNQUFNLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUM7WUFDekIsWUFBWSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDO1lBQ3JDLFdBQVcsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRTtZQUN0QyxxQkFBcUIsRUFBRSxJQUFJLENBQUMsc0JBQXNCO1lBQ2xELFNBQVMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQztZQUMvQixTQUFTLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUM7WUFDL0IsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO1NBQzNCLENBQUMsQ0FBQyxDQUFBO1FBRUgsbUJBQW1CO1FBQ25CLE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxTQUFTLENBQUMsSUFBSTtRQUNaLEtBQUssTUFBTSxLQUFLLElBQUksa0JBQWtCLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUM3QixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsU0FBUyxDQUFDLElBQUk7UUFDWixLQUFLLE1BQU0sS0FBSyxJQUFJLHNCQUFzQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDakQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDN0IsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxDQUFDLEdBQUcsSUFBSTtRQUNsQixPQUFPLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULG1GQUFtRjtRQUNuRixrR0FBa0c7UUFDbEcsZ0dBQWdHO1FBQ2hHLDhDQUE4QztRQUM5QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEQsTUFBTSx5QkFBeUIsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXBHLGlHQUFpRztRQUNqRyxpR0FBaUc7UUFDakcsZ0dBQWdHO1FBQ2hHLCtGQUErRjtRQUMvRiwyREFBMkQ7UUFDM0QsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLElBQUksSUFBSSxJQUFJLENBQUMsT0FBTyxLQUFLLElBQUksSUFBSSxDQUFDLENBQUMseUJBQXlCLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM5RyxPQUFPLE1BQU0sSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFFRCxJQUFJLENBQUMseUJBQXlCLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2pELE1BQU0sSUFBSSxLQUFLLENBQUMsMkNBQTJDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxJQUFJLDBFQUEwRSxDQUFDLENBQUE7UUFDakssQ0FBQztRQUVELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO1FBQ3hELE1BQU0sZUFBZSxHQUFHLHlCQUF5QjtZQUMvQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUU7WUFDOUgsQ0FBQyxDQUFDLEdBQUcsQ0FBQTtRQUNQLElBQUksR0FBRyxHQUFHLFNBQVMsY0FBYyxHQUFHLGVBQWUsR0FBRyxDQUFBO1FBRXRELElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsSUFBSSxPQUFPO1lBQUUsR0FBRyxJQUFJLE9BQU8sQ0FBQTtRQUVwRCxHQUFHLElBQUksV0FBVyxDQUFBO1FBRWxCLGdDQUFnQztRQUNoQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFL0IsVUFBVSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUE7UUFDNUIsVUFBVSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUE7UUFDeEIsVUFBVSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUV0QixNQUFNLE9BQU8sR0FBRyxnQ0FBZ0MsQ0FBQyxDQUFDLE1BQU0sVUFBVSxDQUFDLGFBQWEsQ0FBQztZQUMvRSxPQUFPLEVBQUUsVUFBVSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUM7U0FDMUMsQ0FBQyxDQUFDLENBQUE7UUFFSCw2REFBNkQ7UUFDN0QsSUFBSSxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3hCLE9BQU8sT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtRQUN6QixDQUFDO1FBRUQsaUVBQWlFO1FBQ2pFLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQTtRQUVuQixLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzdCLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUN6QixNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDLENBQUE7WUFDekMsQ0FBQztZQUVELFdBQVcsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFBO1FBQzdCLENBQUM7UUFFRCxPQUFPLFdBQVcsQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQy9CLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQTtRQUNoRixNQUFNLEdBQUcsR0FBRztZQUNWLFVBQVUsUUFBUSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQzNELFNBQVMsVUFBVSxDQUFDLEtBQUssRUFBRSxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLHNCQUFzQixDQUFDLEVBQUU7U0FDcEYsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDWCxNQUFNLE9BQU8sR0FBRyxnQ0FBZ0MsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQ3ZFLEdBQUcsRUFDSCxFQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFDLENBQzVELENBQUMsQ0FBQTtRQUVGLElBQUksT0FBTyxDQUFDLE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUN6QyxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLE1BQU07UUFDWCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUMxQixLQUFLLE1BQU0sV0FBVyxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1lBQzFCLENBQUM7WUFFRCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQy9CLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUVuQyxJQUFJLDBCQUEwQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUNuRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7Z0JBQ3ZDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO2dCQUNqRSxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsYUFBYSxDQUFDLElBQUksYUFBYSxDQUFBO2dCQUMvRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtnQkFDaEQsTUFBTSxlQUFlLEdBQUcsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFBO2dCQUUxRyxPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUE7WUFDdEMsQ0FBQztRQUNILENBQUM7UUFFRCw2RUFBNkU7UUFDN0UsdUVBQXVFO1FBQ3ZFLDhDQUE4QztRQUM5QyxJQUFJLGFBQWEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQzFCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBRXRELE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxZQUFZLENBQUMsTUFBTTtRQUNqQixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBRTNELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILG1CQUFtQixDQUFDLE1BQU0sRUFBRSxNQUFNO1FBQ2hDLEtBQUssTUFBTSxDQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDN0QsTUFBTSxvQkFBb0IsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFbEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUM7Z0JBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUU5QyxLQUFLLE1BQU0sU0FBUyxJQUFJLG9CQUFvQixFQUFFLENBQUM7Z0JBQzdDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztvQkFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQy9FLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFDN0IsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFFeEMsSUFBSSxRQUFRLElBQUksT0FBTyw0Q0FBNEMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN0RyxPQUFPLDRDQUE0QyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQzFFLENBQUM7UUFFRCxJQUFJLFFBQVEsSUFBSSxPQUFPLDRDQUE0QyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ2xHLE1BQU0sZUFBZSxHQUFHLDRCQUE0QixDQUFDLDRDQUE0QyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFbkgsSUFBSSxlQUFlO2dCQUFFLE9BQU8sZUFBZSxDQUFBO1FBQzdDLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxhQUFhO1FBQ1gsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBRTNELE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxVQUFVO1FBQ3ZCLE9BQU8sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFBO0lBQzNCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCx3QkFBd0I7UUFDdEIsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsWUFBWTtRQUMxQixJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtRQUNqQyxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsWUFBWSxDQUFDLFlBQVk7UUFDdkIsTUFBTSxXQUFXLEdBQUcsd0RBQXdELENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUUzRixXQUFXLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtRQUN4QyxXQUFXLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7UUFFNUMsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCw0QkFBNEIsQ0FBQyxJQUFJO1FBQy9CLE9BQU8sSUFBSSxDQUFDLDZCQUE2QixDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFBO0lBQzdELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsNkJBQTZCLENBQUMsSUFBSTtRQUNoQyxJQUFJLFVBQVUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFdEQsS0FBSyxNQUFNLGdCQUFnQixJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3BDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1lBQ3ZFLE1BQU0sZ0JBQWdCLEdBQUcsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUE7WUFFM0QsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQ3RCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLFVBQVUsQ0FBQyxJQUFJLElBQUksZ0JBQWdCLEVBQUUsQ0FBQyxDQUFBO1lBQ3JGLENBQUM7WUFFRCxVQUFVLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3BELENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLElBQUk7UUFDcEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLElBQUksQ0FBQyxDQUFBO1FBRXpELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBQ3hELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsSUFBSTtRQUN4QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFOUUsT0FBTyxLQUFLLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxHQUFHLElBQUk7UUFDOUIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFaEQsT0FBTyxJQUFJLENBQUMscUJBQXFCLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsR0FBRyxJQUFJO1FBQ3JCLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMscUJBQXFCLEVBQUUsb0JBQW9CO1FBQy9DLElBQUksc0JBQXNCLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDM0UsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDcEQsQ0FBQztRQUVELElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMscURBQXFELENBQUMsQ0FBQTtRQUN4RSxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsbUJBQW1CLENBQUM7WUFDOUIsUUFBUSxFQUFFLGtCQUFrQixDQUFDLGdDQUFnQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUN0RixlQUFlLEVBQUUsb0JBQW9CO1NBQ3RDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsZUFBZSxDQUFDLGVBQWU7UUFDN0IsSUFBSSxDQUFDLHNCQUFzQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxzRUFBc0UsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7UUFFRCxNQUFNLGVBQWUsR0FBRyxzQkFBc0IsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUUvRCxJQUFJLGVBQWUsQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxpQ0FBaUMsRUFBRSxFQUFFLENBQUM7WUFDckgsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsZUFBZSxDQUFDLFVBQVUsQ0FBQyxJQUFJLGFBQWEsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksUUFBUSxDQUFDLENBQUE7UUFDaEgsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLDBCQUEwQixDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQztZQUN2RSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsVUFBVSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUU7WUFDaEMsS0FBSyxFQUFFLElBQUk7WUFDWCxLQUFLLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixFQUFFO1NBQ2pDLEVBQUUsR0FBRyxlQUFlLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQTtRQUVqQyxPQUFPLFdBQVcsSUFBSSxJQUFJLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILG1CQUFtQixDQUFDLEVBQUMsUUFBUSxFQUFFLGVBQWUsRUFBQztRQUM3QyxJQUFJLENBQUMsc0JBQXNCLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztZQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLHNFQUFzRSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDNUQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUMsWUFBWSxDQUFDLENBQUE7UUFFekUsTUFBTSxlQUFlLEdBQUcsc0JBQXNCLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFL0QsSUFBSSxlQUFlLENBQUMsaUNBQWlDLEVBQUUsS0FBSyxnQkFBZ0IsQ0FBQyxpQ0FBaUMsRUFBRSxFQUFFLENBQUM7WUFDakgsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsZUFBZSxDQUFDLFVBQVUsQ0FBQyxJQUFJLHVCQUF1QixZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLGdCQUFnQixDQUFDLElBQUksR0FBRyxDQUFDLENBQUE7UUFDNUksQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsQ0FBQTtRQUM1RSxNQUFNLGlCQUFpQixHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFBO1FBQ25ELE1BQU0sa0JBQWtCLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUE7UUFDckQsTUFBTSxZQUFZLEdBQUcsd0NBQXdDLENBQUMsQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDO1lBQ3RGLE1BQU0sRUFBRSxXQUFXLENBQUMsTUFBTTtZQUMxQixVQUFVLEVBQUUsZ0JBQWdCO1lBQzVCLElBQUksRUFBRSxDQUFDLEdBQUcsWUFBWSxDQUFDO1lBQ3ZCLEtBQUssRUFBRSxXQUFXO1lBQ2xCLEtBQUssRUFBRSxXQUFXLENBQUMsd0JBQXdCLEVBQUU7U0FDOUMsRUFBRSxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLFdBQVcsQ0FBQTtRQUVoRCxJQUFJLFlBQVksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxNQUFNLEtBQUssV0FBVyxDQUFDLFFBQVEsRUFBRSxDQUFDLE1BQU07WUFDbEUsWUFBWSxDQUFDLFNBQVMsRUFBRSxDQUFDLE1BQU0sS0FBSyxXQUFXLENBQUMsU0FBUyxFQUFFLENBQUMsTUFBTTtZQUNsRSxZQUFZLENBQUMsVUFBVSxFQUFFLENBQUMsTUFBTSxLQUFLLFdBQVcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxNQUFNO1lBQ3BFLFlBQVksQ0FBQyxPQUFPLENBQUMsTUFBTSxLQUFLLFdBQVcsQ0FBQyxPQUFPLENBQUMsTUFBTTtZQUMxRCxZQUFZLENBQUMsTUFBTSxLQUFLLFdBQVcsQ0FBQyxNQUFNO1lBQzFDLFlBQVksQ0FBQyxPQUFPLEtBQUssV0FBVyxDQUFDLE9BQU87WUFDNUMsWUFBWSxDQUFDLEtBQUssS0FBSyxXQUFXLENBQUMsS0FBSztZQUN4QyxZQUFZLENBQUMsUUFBUSxLQUFLLFdBQVcsQ0FBQyxRQUFRO1lBQzlDLFlBQVksQ0FBQyxTQUFTLEtBQUssV0FBVyxDQUFDLFNBQVM7WUFDaEQsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxLQUFLLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3pGLE1BQU0sSUFBSSxLQUFLLENBQUMsbUVBQW1FLENBQUMsQ0FBQTtRQUN0RixDQUFDO1FBRUQsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxpQkFBaUIsRUFBRSxDQUFDO1lBQ25ELEtBQUssTUFBTSxJQUFJLElBQUksWUFBWSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO2dCQUNoRSxJQUFJLElBQUksWUFBWSxVQUFVLEVBQUUsQ0FBQztvQkFDL0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFBO2dCQUM3RCxDQUFDO3FCQUFNLElBQUksSUFBSSxZQUFZLFNBQVMsRUFBRSxDQUFDO29CQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtnQkFDeEIsQ0FBQztxQkFBTSxDQUFDO29CQUNOLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUN4QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLGtCQUFrQixFQUFFLENBQUM7WUFDckQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUE7UUFDdEUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsbUJBQW1CLENBQUMsZ0JBQWdCLEVBQUUsUUFBUTtRQUM1QyxNQUFNLFdBQVcsR0FBRyx3REFBd0QsQ0FBQyxDQUMzRSxJQUFJLENBQUMsVUFBVTtZQUNiLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQztZQUM1QyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLENBQ2pDLENBQUE7UUFFRCxXQUFXLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7UUFDNUMsV0FBVyxDQUFDLGFBQWEsR0FBRyxRQUFRLENBQUE7UUFDcEMsV0FBVyxDQUFDLHNCQUFzQixHQUFHLElBQUksQ0FBQTtRQUV6QyxPQUFPLFdBQVcsQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFVBQVU7UUFDZCxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVwQyxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzdCLE1BQU0sTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3hCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJO1FBQ2xCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDMUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ2xELE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFcEMsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRWhDLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFO1lBQzNDLE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDN0MsTUFBTSxNQUFNLEdBQUcsS0FBSyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBRTVELE9BQU8sR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxNQUFNLE1BQU0sRUFBRSxDQUFBO1FBQ3hELENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUViLE1BQU0sUUFBUSxHQUFHLElBQUksV0FBVyxDQUFDLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUN0RSxNQUFNLFFBQVEsR0FBRyxJQUFJLFdBQVcsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDdEUsSUFBSSxHQUFHLENBQUE7UUFFUCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDeEIsd0RBQXdEO1lBQ3hELG9DQUFvQztZQUNwQyxNQUFNLFVBQVUsR0FBRyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSx5QkFBeUIsQ0FBQyxDQUFBO1lBQ2xJLE1BQU0sRUFBRSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDekMsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUV2QyxHQUFHLEdBQUcsVUFBVSxFQUFFLFFBQVEsT0FBTyxVQUFVLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsR0FBRyxRQUFRLEdBQUcsUUFBUSxHQUFHLENBQUE7UUFDMUcsQ0FBQzthQUFNLENBQUM7WUFDTixHQUFHLEdBQUcsVUFBVSxNQUFNLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxRQUFRLE9BQU8sR0FBRyxRQUFRLEVBQUUsQ0FBQTtRQUMxRSxDQUFDO1FBRUQsTUFBTSxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxFQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtJQUMzRixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUTtRQUNqQjs7c0RBRThDO1FBQzlDLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUVyQixNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQTtRQUVqRyxNQUFNLFFBQVEsR0FBRyx3REFBd0QsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBRXhGLFFBQVEsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFMUIsTUFBTSxNQUFNLEdBQUcsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBRXZDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNaLE1BQU0sSUFBSSxtQkFBbUIsQ0FBQyxpQkFBaUIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksVUFBVSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxFQUFFLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDckosQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLFVBQVU7UUFDckIsTUFBTSxRQUFRLEdBQUcsd0RBQXdELENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtRQUV4RixRQUFRLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTFCLE9BQU8sTUFBTSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDL0IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsUUFBUTtRQUN2QyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFFbEUsSUFBSSxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN6QixNQUFNLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUNyQixDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsVUFBVTtRQUMzQixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFNUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ3JDLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsUUFBUTtRQUMzQyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFNUMsSUFBSSxNQUFNO1lBQUUsT0FBTyxNQUFNLENBQUE7UUFFekIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUV4QyxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ2IsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3JCLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxVQUFVLEdBQUcsRUFBRTtRQUNuQixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDdkMsTUFBTSxNQUFNLEdBQUcsK0JBQStCLENBQUMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1FBRTNFLElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUV2RCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsRUFBRTtRQUMxQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXJDLE1BQU0sTUFBTSxDQUFDLElBQUksRUFBRSxDQUFBO1FBRW5CLE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsZUFBZSxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDaEwsTUFBTSxPQUFPLEdBQUcsTUFBTSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFeEMsT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFBO0lBQzNCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsSUFBSTtRQUNSLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUN6RCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDbEQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVqSixPQUFPLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsSUFBSTtRQUNWLE1BQU0saUJBQWlCLEdBQUcsc0JBQXNCLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDdEQsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsaUJBQWlCLENBQUMsQ0FBQTtRQUM3QyxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsSUFBSTtRQUNSLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUNqQixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVwQyxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzdCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUUxQixLQUFLLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDaEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNwQixDQUFDO1FBRUQsc0VBQXNFO1FBQ3RFLHlEQUF5RDtRQUN6RCxLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzNCLEtBQUssQ0FBQyxXQUFXLEdBQUcsTUFBTSxDQUFBO1FBQzVCLENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvRCxNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQztnQkFDOUIsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMzQixNQUFNO2dCQUNOLE9BQU8sRUFBRSxJQUFJLENBQUMsUUFBUTtnQkFDdEIsY0FBYyxFQUFFLElBQUksQ0FBQyxlQUFlO2dCQUNwQyxtQkFBbUIsRUFBRSxJQUFJLENBQUMsb0JBQW9CO2FBQy9DLENBQUMsQ0FBQTtZQUVGLE1BQU0sU0FBUyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ3ZCLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sWUFBWSxDQUFDO2dCQUNqQixPQUFPLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQ3hCLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDM0IsTUFBTTthQUNQLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3BELE1BQU0sWUFBWSxDQUFDO2dCQUNqQixPQUFPLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQ3hCLGNBQWMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDL0IsVUFBVSxFQUFFLE1BQU07YUFDbkIsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsT0FBTyxNQUFNLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxPQUFPO1FBQ3BCLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUVsQyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLENBQUMsQ0FBQTtRQUUxRSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7UUFDdkMsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3hDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO1FBQ2pFLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsQ0FBQTtRQUUvRSxNQUFNLEtBQUssR0FBRyx3REFBd0QsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBRXJGLEtBQUssQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFBO1FBQ25CLEtBQUssQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFBO1FBRW5CLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRTtZQUNqQyxNQUFNLFNBQVMsR0FBRyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUE7WUFFL0YsS0FBSyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUN6QixDQUFDLENBQUMsQ0FBQTtRQUVGLE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUU5RSxJQUFJLFdBQVcsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0IsTUFBTSxDQUFDLFVBQVUsQ0FBQyxHQUFHLFdBQVcsQ0FBQTtZQUNoQyxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLDREQUE0RCxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQTtRQUMxRyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDdEIsTUFBTSxPQUFPLEdBQUcsNERBQTRELENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUVsRixPQUFPLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1FBQzdELENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksT0FBTyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7WUFDN0IsT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzNCLENBQUM7UUFFRCxJQUFJLGFBQWEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sRUFBQyxZQUFZLEVBQUUsWUFBWSxFQUFDLEdBQUcsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFDLENBQUMsQ0FBQTtZQUNwRyxNQUFNLFVBQVUsR0FBRyw0QkFBNEIsQ0FBQyxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFFaEcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN4QixDQUFDO1lBRUQsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDekMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7Z0JBQzlGLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksbUJBQW1CLENBQUM7b0JBQ3hDLElBQUksRUFBRSxZQUFZO29CQUNsQixVQUFVLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRTtvQkFDaEMsZ0JBQWdCO29CQUNoQixLQUFLLEVBQUUsSUFBSTtpQkFDWixDQUFDLENBQUMsQ0FBQTtZQUNMLENBQUM7WUFFRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6QyxLQUFLLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzNCLENBQUM7WUFFRCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixPQUFPLEtBQUssS0FBSyxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUE7SUFDdkYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxPQUFPLENBQUMsTUFBTTtRQUNaLE1BQU0sRUFBQyxDQUFDLEVBQUUsR0FBRyxZQUFZLEVBQUMsR0FBRyxNQUFNLENBQUE7UUFDbkMsTUFBTSxLQUFLLEdBQUcscUJBQXFCLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLFlBQVksQ0FBQyxDQUFBO1FBRXZFLGlCQUFpQixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRXZDLElBQUksT0FBTyxDQUFDLEtBQUssUUFBUSxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDakQsTUFBTSxLQUFLLEdBQUcsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFBO1lBRXZELEtBQUssTUFBTSxPQUFPLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBQyxDQUFDLENBQUE7WUFDdkUsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsUUFBUSxDQUFDLEtBQUs7UUFDWixJQUFJLE9BQU8sS0FBSyxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQzdCLE9BQU8sS0FBSyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUM5QixDQUFDO1FBRUQsSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QixNQUFNLEVBQUMsWUFBWSxFQUFFLFlBQVksRUFBQyxHQUFHLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFDcEcsTUFBTSxVQUFVLEdBQUcsNEJBQTRCLENBQUMsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFFLEVBQUMsQ0FBQyxDQUFBO1lBRWhHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDeEIsQ0FBQztZQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3pDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixFQUFFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFBO2dCQUM5RixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFFBQVEsQ0FBQyxJQUFJLG1CQUFtQixDQUFDO29CQUNyRCxJQUFJLEVBQUUsWUFBWTtvQkFDbEIsVUFBVSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUU7b0JBQ2hDLGdCQUFnQjtvQkFDaEIsS0FBSyxFQUFFLElBQUk7aUJBQ1osQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNOLENBQUM7WUFFRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6QyxLQUFLLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzlCLENBQUM7WUFFRCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixPQUFPLEtBQUssS0FBSyxLQUFLLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUE7SUFDdkYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsU0FBUztRQUNwQixPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksSUFBSSxTQUFTLEVBQUUsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLElBQUk7UUFDUixPQUFPLE1BQU0saUJBQWlCLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsTUFBTSxpQkFBaUIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUN4QyxDQUFDO0NBQ0Y7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQztJQUN2QyxNQUFNLEtBQUssR0FBRyxzQkFBc0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBRXBELElBQUksS0FBSyxFQUFFLENBQUM7UUFDVixLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMzQixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsc0JBQXNCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFDO0lBQzVDOztxREFFaUQ7SUFDakQsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO0lBRWpCLEtBQUssTUFBTSxTQUFTLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sS0FBSyxHQUFHLDBCQUEwQixDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFNUQsSUFBSSxLQUFLO1lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBRUQsS0FBSyxNQUFNLFFBQVEsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDdkMsTUFBTSxLQUFLLEdBQUcsc0JBQXNCLENBQUMsRUFBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFOUQsSUFBSSxLQUFLO1lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUMvQixDQUFDO0lBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUNsQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUFFLE9BQU8sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBRXpDLE9BQU8sSUFBSSxlQUFlLENBQUM7UUFDekIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLEtBQUs7UUFDTCxNQUFNO0tBQ1AsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsMEJBQTBCLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFDO0lBQ3BEOztxREFFaUQ7SUFDakQsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO0lBRWpCLEtBQUssTUFBTSxTQUFTLElBQUksU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxTQUFTLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUNsQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUFFLE9BQU8sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBRXpDLE9BQU8sSUFBSSxlQUFlLENBQUM7UUFDekIsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO1FBQ2hDLEtBQUs7UUFDTCxNQUFNO0tBQ1AsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLDBCQUEwQixDQUFDLEVBQUMsU0FBUyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUM7SUFDL0QsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtJQUM5RCxNQUFNLFVBQVUsR0FBRyw0QkFBNEIsQ0FBQyxFQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsS0FBSyxDQUFDLGFBQWEsRUFBRSxFQUFDLENBQUMsQ0FBQTtJQUUxRixJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3ZDLEtBQUssQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDekIsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLElBQUksbUJBQW1CLENBQUM7UUFDcEMsSUFBSTtRQUNKLFVBQVUsRUFBRSxLQUFLLENBQUMsYUFBYSxFQUFFO1FBQ2pDLGdCQUFnQixFQUFFLElBQUk7UUFDdEIsS0FBSztLQUNOLENBQUMsQ0FBQTtJQUVGLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN6RSxPQUFPLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzVCLENBQUM7SUFFRCxJQUFJLFNBQVMsQ0FBQyxTQUFTLEtBQUssTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3ZELE9BQU8sSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDNUIsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMseUJBQXlCLENBQUMsRUFBQyxTQUFTLEVBQUUsU0FBUyxFQUFDO0lBQ3ZELElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN6SSxPQUFPLHNCQUFzQixDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUNwRSxDQUFDO0lBRUQsSUFBSSxTQUFTLENBQUMsU0FBUyxLQUFLLE1BQU0sRUFBRSxDQUFDO1FBQ25DLE9BQU8sc0JBQXNCLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7SUFDekQsQ0FBQztJQUVELE9BQU8sMkJBQTJCLENBQUM7UUFDakMsU0FBUztRQUNULFFBQVEsRUFBRSxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDO1FBQ25ELEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxTQUFTLENBQUM7S0FDcEMsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMsc0JBQXNCLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFDO0lBQ2hEOzsrREFFMkQ7SUFDM0QsSUFBSSxJQUFJLEdBQUcsRUFBQyxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUU3QyxLQUFLLElBQUksS0FBSyxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUNuRSxJQUFJLEdBQUcsRUFBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUN4QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILFNBQVMsMkJBQTJCLENBQUMsRUFBQyxTQUFTLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBQztJQUMvRDs7K0RBRTJEO0lBQzNELElBQUksSUFBSSxHQUFHO1FBQ1QsQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxhQUFhLEVBQUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDO0tBQ3hFLENBQUE7SUFFRCxLQUFLLElBQUksS0FBSyxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUNuRSxJQUFJLEdBQUcsRUFBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUN4QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsb0JBQW9CLENBQUMsU0FBUztJQUNyQyxJQUFJLFNBQVMsS0FBSyxJQUFJLElBQUksU0FBUyxLQUFLLE1BQU0sSUFBSSxTQUFTLEtBQUssSUFBSSxJQUFJLFNBQVMsS0FBSyxNQUFNLEVBQUUsQ0FBQztRQUM3RixPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENBQUMsU0FBUztJQUNsQyxJQUFJLFNBQVMsQ0FBQyxTQUFTLEtBQUssTUFBTTtRQUFFLE9BQU8sSUFBSSxTQUFTLENBQUMsS0FBSyxHQUFHLENBQUE7SUFDakUsSUFBSSxTQUFTLENBQUMsU0FBUyxLQUFLLE9BQU87UUFBRSxPQUFPLEdBQUcsU0FBUyxDQUFDLEtBQUssR0FBRyxDQUFBO0lBQ2pFLElBQUksU0FBUyxDQUFDLFNBQVMsS0FBSyxLQUFLO1FBQUUsT0FBTyxJQUFJLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUUvRCxPQUFPLFNBQVMsQ0FBQyxLQUFLLENBQUE7QUFDeEIsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsZ0JBQWdCO0lBQ3pELE9BQU8sVUFBVSxDQUFDLG1CQUFtQixFQUFFLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtBQUMzRCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGlCQUFpQixDQUFDLFVBQVUsRUFBRSxHQUFHO0lBQ3hDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO0lBRWpFLElBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQztRQUFFLE9BQU8sWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFBO0lBRS9DLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFBO0lBQzlELE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUE7SUFFOUMsT0FBTyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksU0FBUyxDQUFDLFdBQVcsQ0FBQyxJQUFJLFNBQVMsQ0FBQTtBQUM5RCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFDO0lBQ3hDOzsrREFFMkQ7SUFDM0QsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFBO0lBQ3ZCOzsrREFFMkQ7SUFDM0QsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFBO0lBRXZCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDdkIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZCLE1BQU0sUUFBUSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUNyQyxNQUFNLFlBQVksR0FBRyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUE7UUFFM0QsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNiLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sbUJBQW1CLEdBQUcsWUFBWSxDQUFDLG1CQUFtQixFQUFFLENBQUE7Z0JBQzlELElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO29CQUN6QixZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFBO29CQUN6QixTQUFRO2dCQUNWLENBQUM7Z0JBQ0QsTUFBTSxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsNEJBQTRCLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtnQkFDckYsTUFBTSxZQUFZLEdBQUcsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQyxDQUFBO2dCQUNoRixNQUFNLGtCQUFrQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxDQUFBO2dCQUNqRSxNQUFNLGtCQUFrQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxDQUFBO2dCQUVqRSxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDbEMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFlBQVksQ0FBQyxZQUFZLENBQUE7Z0JBQy9DLENBQUM7Z0JBRUQsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ2xDLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxDQUFBO29CQUU5QyxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQzt3QkFBRSxZQUFZLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxDQUFBO29CQUMxRCxNQUFNLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsRUFBRSxZQUFZLENBQUMsWUFBWSxDQUFDLENBQUE7Z0JBQ25FLENBQUM7WUFDSCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUMzQixDQUFDO1FBQ0gsQ0FBQzthQUFNLElBQUksWUFBWSxJQUFJLGtDQUFrQyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDckUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLHdDQUF3QyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3JFLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxVQUFVLEdBQUcsaUJBQWlCLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFBO1lBRXJELElBQUksVUFBVSxFQUFFLENBQUM7Z0JBQ2YsWUFBWSxDQUFDLFVBQVUsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNsQyxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUMzQixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEVBQUMsWUFBWSxFQUFFLFlBQVksRUFBQyxDQUFBO0FBQ3JDLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFTLDRCQUE0QixDQUFDLEVBQUMsSUFBSSxFQUFFLFVBQVUsRUFBQztJQUN0RDs7K0RBRTJEO0lBQzNELE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtJQUVyQixLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3ZCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUN2QixNQUFNLFlBQVksR0FBRyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUE7UUFFM0QsSUFBSSxDQUFDLFlBQVk7WUFBRSxTQUFRO1FBRTNCLElBQUksYUFBYSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsTUFBTSxtQkFBbUIsR0FBRyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUM5RCxJQUFJLENBQUMsbUJBQW1CO2dCQUFFLFNBQVE7WUFDbEMsTUFBTSxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsNEJBQTRCLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtZQUNyRixNQUFNLGdCQUFnQixHQUFHLDRCQUE0QixDQUFDLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQyxDQUFBO1lBRWxHLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNwRixTQUFRO1FBQ1YsQ0FBQztRQUVELElBQUksa0NBQWtDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUM5QyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFBO1FBQ3hCLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQztBQUVELE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtBQUVySDs7OztHQUlHO0FBQ0gsU0FBUyxrQ0FBa0MsQ0FBQyxRQUFRO0lBQ2xELE1BQU0sZUFBZSxHQUFHO1FBQ3RCLEdBQUcsRUFBRSxJQUFJO1FBQ1QsSUFBSSxFQUFFLE1BQU07UUFDWixHQUFHLEVBQUUsSUFBSTtRQUNULElBQUksRUFBRSxNQUFNO0tBQ2IsQ0FBQTtJQUVELE9BQU8sc0VBQXNFLENBQUMsQ0FDNUUsZUFBZSxFQUFDLHNDQUF1QyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksUUFBUSxDQUMvRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdDQUFnQyxDQUFDLFVBQVU7SUFDbEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN4RCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRCxPQUFPLE9BQU8sVUFBVSxDQUFDLENBQUMsQ0FBQyxLQUFLLFFBQVE7UUFDdEMsT0FBTyxVQUFVLENBQUMsQ0FBQyxDQUFDLEtBQUssUUFBUTtRQUNqQywwQkFBMEIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDakQsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHdDQUF3QyxDQUFDLEtBQUs7SUFDckQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxPQUFPLEtBQUssRUFBRSxDQUFDLENBQUE7SUFDckYsQ0FBQztJQUVEOzttR0FFK0Y7SUFDL0YsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO0lBQ25COzs7T0FHRztJQUNILE1BQU0sWUFBWSxHQUFHLENBQUMsY0FBYyxFQUFFLEVBQUU7UUFDdEMsSUFBSSxnQ0FBZ0MsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQ3JELE1BQU0sS0FBSyxHQUFHLHNJQUFzSSxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDckssTUFBTSxrQkFBa0IsR0FBRyxrQ0FBa0MsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUV2RSxVQUFVLENBQUMsSUFBSSxDQUFDO2dCQUNkLEtBQUssQ0FBQyxDQUFDLENBQUM7Z0JBQ1Isa0JBQWtCO2dCQUNsQixLQUFLLENBQUMsQ0FBQyxDQUFDO2FBQ1QsQ0FBQyxDQUFBO1lBRUYsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNyQixLQUFLLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQ3JELFlBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFDNUIsQ0FBQztZQUNMLENBQUM7WUFFRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxtREFBbUQsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLG9CQUFvQixFQUFFLEVBQUU7WUFDcEcsWUFBWSxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDcEMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDLENBQUE7SUFFRCxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7SUFFbkIsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtDQUFrQyxDQUFDLEtBQUs7SUFDL0MsSUFBSSxDQUFDO1FBQ0gsd0NBQXdDLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFL0MsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCB7Y3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMsIHJ1blF1ZXJ5RGF0YX0gZnJvbSBcIi4vcXVlcnktZGF0YS5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVdpdGhDb3VudCwgcnVuV2l0aENvdW50fSBmcm9tIFwiLi93aXRoLWNvdW50LmpzXCJcbmltcG9ydCBEYXRhYmFzZVF1ZXJ5IGZyb20gXCIuL2luZGV4LmpzXCJcbmltcG9ydCBKb2luT2JqZWN0IGZyb20gXCIuL2pvaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBKb2luUGxhaW4gZnJvbSBcIi4vam9pbi1wbGFpbi5qc1wiXG5pbXBvcnQgSm9pblRyYWNrZXIgZnJvbSBcIi4vam9pbi10cmFja2VyLmpzXCJcbmltcG9ydCBSZWNvcmROb3RGb3VuZEVycm9yIGZyb20gXCIuLi9yZWNvcmQvcmVjb3JkLW5vdC1mb3VuZC1lcnJvci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVJhbnNhY2tHcm91cCwgcGFyc2VSYW5zYWNrU29ydH0gZnJvbSBcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIlxuaW1wb3J0IHtpc01vZGVsU2NvcGVEZXNjcmlwdG9yfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCBzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgV2hlcmVDb21iaW5hdG9yIGZyb20gXCIuL3doZXJlLWNvbWJpbmF0b3IuanNcIlxuaW1wb3J0IFdoZXJlTW9kZWxDbGFzc0hhc2ggZnJvbSBcIi4vd2hlcmUtbW9kZWwtY2xhc3MtaGFzaC5qc1wiXG5pbXBvcnQgV2hlcmVOb3QgZnJvbSBcIi4vd2hlcmUtbm90LmpzXCJcbmltcG9ydCBKb2luc1BhcnNlciBmcm9tIFwiLi4vcXVlcnktcGFyc2VyL2pvaW5zLXBhcnNlci5qc1wiXG5pbXBvcnQgV2hlcmVQYXJzZXIgZnJvbSBcIi4uL3F1ZXJ5LXBhcnNlci93aGVyZS1wYXJzZXIuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtNQz10eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5RdWVyeUFyZ3NUeXBlICYge21vZGVsQ2xhc3M6IE1DLCBqb2luQmFzZVBhdGg/OiBzdHJpbmdbXSwgam9pblRyYWNrZXI/OiBpbXBvcnQoXCIuL2pvaW4tdHJhY2tlci5qc1wiKS5kZWZhdWx0LCBmb3JjZVF1YWxpZnlCYXNlVGFibGU/OiBib29sZWFuLCB3aXRoQ291bnQ/OiBpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50RW50cnlbXSwgcXVlcnlEYXRhPzogaW1wb3J0KFwiLi9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUVudHJ5W10sIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gTW9kZWxDbGFzc1F1ZXJ5QXJnc1R5cGVcbiAqL1xuLyoqXG4gKiBSdW5zIHVucXVvdGUgc3FsIGlkZW50aWZpZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBQb3RlbnRpYWxseSBxdW90ZWQgU1FMIGlkZW50aWZpZXIuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIGlkZW50aWZpZXIuXG4gKi9cbmZ1bmN0aW9uIHVucXVvdGVTcWxJZGVudGlmaWVyKHZhbHVlKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAodHJpbW1lZC5sZW5ndGggPj0gMiAmJiAoKHRyaW1tZWQuc3RhcnRzV2l0aChcImBcIikgJiYgdHJpbW1lZC5lbmRzV2l0aChcImBcIikpIHx8ICh0cmltbWVkLnN0YXJ0c1dpdGgoXCJcXFwiXCIpICYmIHRyaW1tZWQuZW5kc1dpdGgoXCJcXFwiXCIpKSkpIHtcbiAgICByZXR1cm4gdHJpbW1lZC5zbGljZSgxLCAtMSlcbiAgfVxuXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+PSAyICYmIHRyaW1tZWQuc3RhcnRzV2l0aChcIltcIikgJiYgdHJpbW1lZC5lbmRzV2l0aChcIl1cIikpIHtcbiAgICByZXR1cm4gdHJpbW1lZC5zbGljZSgxLCAtMSlcbiAgfVxuXG4gIHJldHVybiB0cmltbWVkXG59XG5cbi8qKlxuICogUnVucyBwYXJzZSBmcm9tIHBsYWluIHRhYmxlIHJlZmVyZW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmcm9tUGxhaW4gLSBGUk9NIGNsYXVzZSBzb3VyY2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBQYXJzZWQgdGFibGUgcmVmZXJlbmNlIG9yIG51bGwgd2hlbiB1bnN1cHBvcnRlZC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VGcm9tUGxhaW5UYWJsZVJlZmVyZW5jZShmcm9tUGxhaW4pIHtcbiAgY29uc3QgdHJpbW1lZCA9IGZyb21QbGFpbi50cmltKClcblxuICBpZiAodHJpbW1lZC5sZW5ndGggPCAxKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGFsaWFzTWF0Y2ggPSB0cmltbWVkLm1hdGNoKC8oPzpefFxccykoPzpBU1xccyspPyhbYFwiXT9bYS16QS1aX11bYS16QS1aMC05X10qW2BcIl0/fFxcW1thLXpBLVpfXVthLXpBLVowLTlfXSpcXF0pXFxzKiQvaSlcblxuICBpZiAoIWFsaWFzTWF0Y2ggfHwgIWFsaWFzTWF0Y2hbMV0pIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIHVucXVvdGVTcWxJZGVudGlmaWVyKGFsaWFzTWF0Y2hbMV0pXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc2NvcGUgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW119IHBhdGggLSBTY29wZSBwYXRoIGlucHV0LlxuICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vcm1hbGl6ZWQgcGF0aC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU2NvcGVQYXRoKHBhdGgpIHtcbiAgaWYgKHR5cGVvZiBwYXRoID09PSBcInN0cmluZ1wiKSB7XG4gICAgaWYgKHBhdGgubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiU2NvcGUgcGF0aCBzdHJpbmdzIG11c3QgYmUgbm9uLWVtcHR5XCIpXG5cbiAgICByZXR1cm4gW3BhdGhdXG4gIH1cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2NvcGUgcGF0aCB0eXBlOiAke3R5cGVvZiBwYXRofWApXG4gIH1cblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBhdGgpIHtcbiAgICBpZiAodHlwZW9mIGVudHJ5ICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlNjb3BlIHBhdGggZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzXCIpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIFsuLi5wYXRoXVxufVxuXG4vKipcbiAqIE5hcnJvd3MgYSBzaGFyZWQgbW9kZWwtc2NvcGUgZGVzY3JpcHRvciB0byB0aGUgYmFja2VuZCBtb2RlbCBjbGFzcyByZXF1aXJlZCBieSBNb2RlbENsYXNzUXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfSBzY29wZURlc2NyaXB0b3IgLSBTaGFyZWQgc2NvcGUgZGVzY3JpcHRvci5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gQmFja2VuZCBzY29wZSBvd25lci5cbiAqL1xuZnVuY3Rpb24gYmFja2VuZFNjb3BlTW9kZWxDbGFzcyhzY29wZURlc2NyaXB0b3IpIHtcbiAgY29uc3QgbW9kZWxDbGFzcyA9IHNjb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzXG5cbiAgaWYgKCEoXCJjYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcIiBpbiBtb2RlbENsYXNzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkEgZnJvbnRlbmQtbW9kZWwgc2NvcGUgY2Fubm90IGJlIGFwcGxpZWQgdG8gYSBkYXRhYmFzZSByZWNvcmQgcXVlcnlcIilcbiAgfVxuXG4gIC8vIFRoZSBydW50aW1lIG1lbWJlciBjaGVjayBhYm92ZSBuYXJyb3dzIHRoZSBzaGFyZWQgZnJvbnRlbmQvYmFja2VuZCBkZXNjcmlwdG9yIGJvdW5kYXJ5LlxuICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIERlZXAtY29waWVzIGEgcHJlbG9hZCBzZWxlY3QgbWFwIChrZXllZCBieSBtb2RlbCBuYW1lIHdpdGggYXR0cmlidXRlIGFycmF5cylcbiAqIHNvIGEgY2xvbmVkIHF1ZXJ5J3Mgc2VsZWN0aW9ucyBjYW4gYmUgbXV0YXRlZCB3aXRob3V0IGFmZmVjdGluZyB0aGUgb3JpZ2luYWwuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gbWFwIC0gUHJlbG9hZCBzZWxlY3QgbWFwIHRvIGNvcHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAtIEEgY29weSB3aXRoIGluZGVwZW5kZW50IGFycmF5cy5cbiAqL1xuZnVuY3Rpb24gY2xvbmVQcmVsb2FkU2VsZWN0TWFwKG1hcCkge1xuICAvKipcbiAgICogUmVzdWx0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICBjb25zdCByZXN1bHQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMobWFwKSkge1xuICAgIHJlc3VsdFttb2RlbE5hbWVdID0gWy4uLmF0dHJpYnV0ZXNdXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcHJlbG9hZCByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIGRhdGEgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gLSBOb3JtYWxpemVkIHByZWxvYWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVQcmVsb2FkUmVjb3JkKHByZWxvYWQpIHtcbiAgaWYgKCFwcmVsb2FkKSByZXR1cm4ge31cblxuICBpZiAodHlwZW9mIHByZWxvYWQgPT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7W3ByZWxvYWRdOiB0cnVlfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocHJlbG9hZCkpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcmVsb2FkKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgcmVzdWx0W2VudHJ5XSA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QoZW50cnkpKSB7XG4gICAgICAgIGluY29ycG9yYXRlKHJlc3VsdCwgbm9ybWFsaXplUHJlbG9hZFJlY29yZChlbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcmVsb2FkIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHByZWxvYWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdHlwZTogJHt0eXBlb2YgcHJlbG9hZH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3VsdC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge31cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgIHJlc3VsdFtrZXldID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcInN0cmluZ1wiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpIHx8IGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICByZXN1bHRba2V5XSA9IG5vcm1hbGl6ZVByZWxvYWRSZWNvcmQodmFsdWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcmVsb2FkIHZhbHVlIGZvciAke2tleX06ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW01DPXR5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqL1xuXG4vKipcbiAqIEEgZ2VuZXJpYyBxdWVyeSBvdmVyIHNvbWUgbW9kZWwgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5IGV4dGVuZHMgRGF0YWJhc2VRdWVyeSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge01vZGVsQ2xhc3NRdWVyeUFyZ3NUeXBlPE1DPn0gYXJncyAtIFF1ZXJ5IGNvbnN0cnVjdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBjb25zdCB7bW9kZWxDbGFzc30gPSBhcmdzXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgTm8gbW9kZWxDbGFzcyBnaXZlbiBpbiAke09iamVjdC5rZXlzKGFyZ3MpLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgc3VwZXIoYXJncylcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TUN9ICovXG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICB0aGlzLl9qb2luQmFzZVBhdGggPSBhcmdzLmpvaW5CYXNlUGF0aCB8fCBbXVxuICAgIHRoaXMuX2pvaW5UcmFja2VyID0gYXJncy5qb2luVHJhY2tlciB8fCBuZXcgSm9pblRyYWNrZXIoe21vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzc30pXG4gICAgdGhpcy5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gQm9vbGVhbihhcmdzLmZvcmNlUXVhbGlmeUJhc2VUYWJsZSlcbiAgICB0aGlzLl9vcGVyYXRpb24gPSBhcmdzLm9wZXJhdGlvblxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50RW50cnlbXX0gKi9cbiAgICB0aGlzLl93aXRoQ291bnQgPSBhcmdzLndpdGhDb3VudCA/IFsuLi5hcmdzLndpdGhDb3VudF0gOiBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRW50cnlbXX0gKi9cbiAgICB0aGlzLl9xdWVyeURhdGEgPSBhcmdzLnF1ZXJ5RGF0YSA/IFsuLi5hcmdzLnF1ZXJ5RGF0YV0gOiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvbmUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBjbG9uZS5cbiAgICovXG4gIGNsb25lKCkge1xuICAgIGNvbnN0IG5ld1F1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKG5ldyBWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5KHtcbiAgICAgIGRyaXZlcjogdGhpcy5fZHJpdmVyRm4sXG4gICAgICBmcm9tczogWy4uLnRoaXMuX2Zyb21zXSxcbiAgICAgIGhhbmRsZXI6IHRoaXMuaGFuZGxlci5jbG9uZSgpLFxuICAgICAgZ3JvdXBzOiBbLi4udGhpcy5fZ3JvdXBzXSxcbiAgICAgIGpvaW5zOiBbLi4udGhpcy5fam9pbnNdLFxuICAgICAgbGltaXQ6IHRoaXMuX2xpbWl0LFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgb2Zmc2V0OiB0aGlzLl9vZmZzZXQsXG4gICAgICBvcmRlcnM6IFsuLi50aGlzLl9vcmRlcnNdLFxuICAgICAgcGFnZTogdGhpcy5fcGFnZSxcbiAgICAgIHBlclBhZ2U6IHRoaXMuX3BlclBhZ2UsXG4gICAgICBwcmVsb2FkOiB7Li4udGhpcy5fcHJlbG9hZH0sXG4gICAgICBwcmVsb2FkU2VsZWN0czogY2xvbmVQcmVsb2FkU2VsZWN0TWFwKHRoaXMuX3ByZWxvYWRTZWxlY3RzKSxcbiAgICAgIHByZWxvYWRTZWxlY3RzRXh0cmE6IGNsb25lUHJlbG9hZFNlbGVjdE1hcCh0aGlzLl9wcmVsb2FkU2VsZWN0c0V4dHJhKSxcbiAgICAgIGRpc3RpbmN0OiB0aGlzLl9kaXN0aW5jdCxcbiAgICAgIHNlbGVjdHM6IFsuLi50aGlzLl9zZWxlY3RzXSxcbiAgICAgIHNpZ25hbDogdGhpcy5fc2lnbmFsLFxuICAgICAgd2hlcmVzOiBbLi4udGhpcy5fd2hlcmVzXSxcbiAgICAgIGpvaW5CYXNlUGF0aDogWy4uLnRoaXMuX2pvaW5CYXNlUGF0aF0sXG4gICAgICBqb2luVHJhY2tlcjogdGhpcy5fam9pblRyYWNrZXIuY2xvbmUoKSxcbiAgICAgIGZvcmNlUXVhbGlmeUJhc2VUYWJsZTogdGhpcy5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlLFxuICAgICAgd2l0aENvdW50OiBbLi4udGhpcy5fd2l0aENvdW50XSxcbiAgICAgIHF1ZXJ5RGF0YTogWy4uLnRoaXMuX3F1ZXJ5RGF0YV0sXG4gICAgICBvcGVyYXRpb246IHRoaXMuX29wZXJhdGlvblxuICAgIH0pKVxuXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIHJldHVybiBuZXdRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFRlbGwgdGhlIHF1ZXJ5IHRvIGF0dGFjaCBvbmUgb3IgbW9yZSBhc3NvY2lhdGlvbiBjb3VudHMgb250byBldmVyeVxuICAgKiBsb2FkZWQgcmVjb3JkLiBUaGUgY291bnRzIGxhbmQgYXMgcmVndWxhciBhdHRyaWJ1dGVzIG9uIGVhY2ggcmVjb3JkO1xuICAgKiByZWFkIHRoZW0gd2l0aCBgbW9kZWwucmVhZEF0dHJpYnV0ZShcIjxuYW1lPkNvdW50XCIpYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3dpdGgtY291bnQuanNcIikuV2l0aENvdW50U3BlY30gc3BlYyAtIENvdW50IHNwZWMgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5LCBmb3IgY2hhaW5pbmcuXG4gICAqL1xuICB3aXRoQ291bnQoc3BlYykge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygbm9ybWFsaXplV2l0aENvdW50KHNwZWMpKSB7XG4gICAgICB0aGlzLl93aXRoQ291bnQucHVzaChlbnRyeSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBvbmUgb3IgbW9yZSBjb25zdW1lci1kZWZpbmVkLCBwZXItcm93IGNvbXB1dGVkIHZhbHVlcyBvbnRvXG4gICAqIGV2ZXJ5IGxvYWRlZCByb290IHJlY29yZC4gTGVhZiBzdHJpbmdzIGluIHRoZSBzcGVjIGFyZSBuYW1lcyBvZlxuICAgKiBmdW5jdGlvbnMgcHJldmlvdXNseSByZWdpc3RlcmVkIHZpYSBgTW9kZWwucXVlcnlEYXRhKG5hbWUsIGZuKWAuXG4gICAqIE5lc3RlZCBvYmplY3Qga2V5cyBhcmUgcmVsYXRpb25zaGlwIG5hbWVzIHRyYWNlZCBmcm9tIHRoZSByb290IHRvXG4gICAqIHRoZSBtb2RlbCB0aGF0IGRlY2xhcmVzIHRoZSBmbi4gRXZlcnkgcmVzdWx0aW5nIFNFTEVDVCBhbGlhcyBpc1xuICAgKiBhdHRhY2hlZCB0byB0aGUgKipyb290KiogcmVjb3JkIChub3QgdG8gdGhlIGludGVybWVkaWF0ZSBqb2luZWRcbiAgICogcm93cyk7IHJlYWQgdmFsdWVzIHdpdGggYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuXG4gICAqXG4gICAqIFNlZSBhbHNvIGBzcmMvZGF0YWJhc2UvcXVlcnkvcXVlcnktZGF0YS5qc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YVNwZWN9IHNwZWMgLSBTcGVjIGluIHNob3J0aGFuZCBvciBuZXN0ZWQgZm9ybS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSwgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgcXVlcnlEYXRhKHNwZWMpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMoc3BlYykpIHtcbiAgICAgIHRoaXMuX3F1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpIHJlZ2lzdGVyZWQgZm9yIHRoZVxuICAgKiBnaXZlbiByZWxhdGlvbnNoaXAgY2hhaW4sIHJlbGF0aXZlIHRvIHRoZSBxdWVyeSdzIGN1cnJlbnQgam9pbiBiYXNlXG4gICAqIHBhdGguIENvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBnZXRUYWJsZVJlZmVyZW5jZUZvckpvaW5gIGZvciB1c2VcbiAgICogaW5zaWRlIGBxdWVyeURhdGFgIGNhbGxiYWNrcyB3aGVyZSB0aGUgd3JpdGVyJ3MgaW50ZW50IHJlYWRzIG1vcmVcbiAgICogbmF0dXJhbGx5IGFzIFwiZ2l2ZSBtZSB0aGUgdGFibGUgbmFtZSBmb3IgJ3Rhc2tzJ1wiLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIHNlZ21lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIHRhYmxlIHJlZmVyZW5jZS5cbiAgICovXG4gIHRhYmxlTmFtZUZvciguLi5wYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50KCkge1xuICAgIC8vIEEgbW9kZWwgd2l0aG91dCBhIHNpbmdsZSBwcmltYXJ5LWtleSBjb2x1bW4g4oCUIHNldFByaW1hcnlLZXkobnVsbCkgb3IgYSBjb21wb3NpdGVcbiAgICAvLyBzZXRQcmltYXJ5S2V5KFsuLi5dKSBvbiBsZWdhY3kgdGFibGVzIOKAlCBoYXMgbm8gY29sdW1uIENPVU5UIGNhbiByZWZlcmVuY2UgKGFuIGFycmF5IHByaW1hcnkga2V5XG4gICAgLy8gY2Fubm90IGJlIHF1b3RlZCBhcyBhIHNpbmdsZSBDT1VOVChjb2x1bW4pLCBhbmQgcHJpbWFyeUtleSgpIGZhbGxzIGJhY2sgdG8gXCJpZFwiIGZvciB0aGUgbm8tcGtcbiAgICAvLyBjYXNlLCBzbyBoYXNQcmltYXJ5S2V5KCkgZGV0ZWN0cyB0aGF0IG9uZSkuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGhhc1NpbmdsZUNvbHVtblByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5oYXNQcmltYXJ5S2V5KCkgJiYgIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcblxuICAgIC8vIFBhZ2luYXRpb24sIG9yIGFuIHVuZ3JvdXBlZCBxdWVyeSBvbiBhIG1vZGVsIHdpdGggbm8gc2luZ2xlIHByaW1hcnkta2V5IGNvbHVtbiwgY291bnRzIHZpYSB0aGVcbiAgICAvLyBzdWJxdWVyeSBmb3JtLiBJdCByZWZlcmVuY2VzIG5vIHByaW1hcnkta2V5IGNvbHVtbiBhbmQgcHJlc2VydmVzIERJU1RJTkNUIG92ZXIgam9pbnMg4oCUIHdoaWNoIGFcbiAgICAvLyBiYXJlIENPVU5UKCopIHdvdWxkIG5vdCAoaXQgd291bGQgY291bnQgam9pbmVkIGR1cGxpY2F0ZSByb3dzIGluc3RlYWQgb2YgZGlzdGluY3Qgcm9vdCByb3dzKS5cbiAgICAvLyBBIGdyb3VwZWQgcXVlcnkgc3RheXMgb24gdGhlIHBlci1ncm91cCBmbG93IGJlbG93LCBiZWNhdXNlIHRoZSBzdWJxdWVyeSBmb3JtIHdvdWxkIGNvdW50IG9uZVxuICAgIC8vIHJvdyBwZXIgZ3JvdXAgaW5zdGVhZCBvZiBzdW1taW5nIGVhY2ggZ3JvdXAncyByb3cgY291bnQuXG4gICAgaWYgKHRoaXMuX2xpbWl0ICE9PSBudWxsIHx8IHRoaXMuX29mZnNldCAhPT0gbnVsbCB8fCAoIWhhc1NpbmdsZUNvbHVtblByaW1hcnlLZXkgJiYgdGhpcy5fZ3JvdXBzLmxlbmd0aCA9PSAwKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucGFnaW5hdGVkQ291bnQoKVxuICAgIH1cblxuICAgIGlmICghaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleSAmJiB0aGlzLl9kaXN0aW5jdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW4ndCBjb3VudCBhIGdyb3VwZWQgZGlzdGluY3QgcXVlcnkgb24gJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBiZWNhdXNlIGl0IGhhcyBubyBzaW5nbGUgcHJpbWFyeS1rZXkgY29sdW1uIHRvIGNvdW50IGRpc3RpbmN0IHZhbHVlcyBvZmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlzdGluY3RQcmVmaXggPSB0aGlzLl9kaXN0aW5jdCA/IFwiRElTVElOQ1QgXCIgOiBcIlwiXG4gICAgY29uc3QgY291bnRFeHByZXNzaW9uID0gaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleVxuICAgICAgPyBgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbigvKiogQHR5cGUge3N0cmluZ30gKi8gKHByaW1hcnlLZXkpKX1gXG4gICAgICA6IFwiKlwiXG4gICAgbGV0IHNxbCA9IGBDT1VOVCgke2Rpc3RpbmN0UHJlZml4fSR7Y291bnRFeHByZXNzaW9ufSlgXG5cbiAgICBpZiAodGhpcy5kcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIikgc3FsICs9IFwiOjppbnRcIlxuXG4gICAgc3FsICs9IFwiIEFTIGNvdW50XCJcblxuICAgIC8vIENsb25lIHF1ZXJ5IGFuZCBleGVjdXRlIGNvdW50XG4gICAgY29uc3QgY291bnRRdWVyeSA9IHRoaXMuY2xvbmUoKVxuXG4gICAgY291bnRRdWVyeS5fZGlzdGluY3QgPSBmYWxzZVxuICAgIGNvdW50UXVlcnkuX3NlbGVjdHMgPSBbXVxuICAgIGNvdW50UXVlcnkuc2VsZWN0KHNxbClcblxuICAgIGNvbnN0IHJlc3VsdHMgPSAvKiogQHR5cGUge3tjb3VudDogbnVtYmVyfVtdfSAqLyAoYXdhaXQgY291bnRRdWVyeS5fZXhlY3V0ZVF1ZXJ5KHtcbiAgICAgIGxvZ05hbWU6IGNvdW50UXVlcnkucXVlcnlMb2dOYW1lKFwiQ291bnRcIilcbiAgICB9KSlcblxuICAgIC8vIFRoZSBxdWVyeSBpc24ndCBncm91cGVkIGFuZCBhIHNpbmdsZSByZXN1bHQgaGFzIGJlZW4gZ2l2ZW5cbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT0gMSkge1xuICAgICAgcmV0dXJuIHJlc3VsdHNbMF0uY291bnRcbiAgICB9XG5cbiAgICAvLyBUaGUgcXVlcnkgbWF5IGJlIGdyb3VwZWQgYW5kIGEgbG90IG9mIGRpZmZlcmVudCBjb3VudHMgYSBnaXZlblxuICAgIGxldCBjb3VudFJlc3VsdCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgIGlmICghKFwiY291bnRcIiBpbiByZXN1bHQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgY291bnQgcmVzdWx0XCIpXG4gICAgICB9XG5cbiAgICAgIGNvdW50UmVzdWx0ICs9IHJlc3VsdC5jb3VudFxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnaW5hdGVkIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvdW50IGFmdGVyIHBhZ2luYXRpb24gaXMgYXBwbGllZC5cbiAgICovXG4gIGFzeW5jIHBhZ2luYXRlZENvdW50KCkge1xuICAgIGNvbnN0IGNvdW50UXVlcnkgPSB0aGlzLmNsb25lKClcbiAgICBjb25zdCBjb3VudFNxbCA9IHRoaXMuZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCIgPyBcIkNPVU5UKCopOjppbnRcIiA6IFwiQ09VTlQoKilcIlxuICAgIGNvbnN0IHNxbCA9IFtcbiAgICAgIGBTRUxFQ1QgJHtjb3VudFNxbH0gQVMgJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihcImNvdW50XCIpfWAsXG4gICAgICBgRlJPTSAoJHtjb3VudFF1ZXJ5LnRvU3FsKCl9KSBBUyAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUoXCJwYWdpbmF0ZWRfY291bnRfcm93c1wiKX1gXG4gICAgXS5qb2luKFwiIFwiKVxuICAgIGNvbnN0IHJlc3VsdHMgPSAvKiogQHR5cGUge3tjb3VudDogbnVtYmVyfVtdfSAqLyAoYXdhaXQgdGhpcy5kcml2ZXIucXVlcnkoXG4gICAgICBzcWwsXG4gICAgICB7bG9nTmFtZTogdGhpcy5xdWVyeUxvZ05hbWUoXCJDb3VudFwiKSwgc2lnbmFsOiB0aGlzLl9zaWduYWx9XG4gICAgKSlcblxuICAgIGlmIChyZXN1bHRzLmxlbmd0aCAhPSAxIHx8ICEoXCJjb3VudFwiIGluIHJlc3VsdHNbMF0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGNvdW50IHJlc3VsdFwiKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzWzBdLmNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5TZWxlY3RBcmd1bWVudFR5cGV9IHNlbGVjdCAtIFNlbGVjdC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHNlbGVjdC5cbiAgICovXG4gIHNlbGVjdChzZWxlY3QpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgICBmb3IgKGNvbnN0IHNlbGVjdEVudHJ5IG9mIHNlbGVjdCkge1xuICAgICAgICB0aGlzLnNlbGVjdChzZWxlY3RFbnRyeSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHNlbGVjdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgdHJpbW1lZFNlbGVjdCA9IHNlbGVjdC50cmltKClcblxuICAgICAgaWYgKC9eW2EtekEtWl9dW2EtekEtWjAtOV9dKiQvLnRlc3QodHJpbW1lZFNlbGVjdCkpIHtcbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBhdHRyaWJ1dGVNYXBbdHJpbW1lZFNlbGVjdF0gfHwgdHJpbW1lZFNlbGVjdFxuICAgICAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHRoaXMucm9vdFRhYmxlUmVmZXJlbmNlKClcbiAgICAgICAgY29uc3QgcXVhbGlmaWVkQ29sdW1uID0gYCR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7dGhpcy5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgICAgIHJldHVybiBzdXBlci5zZWxlY3QocXVhbGlmaWVkQ29sdW1uKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9iamVjdCBmb3JtIGtleWVkIGJ5IHRhcmdldCBtb2RlbCBuYW1lLCBlLmcuIGAuc2VsZWN0KHtBY2NvdW50OiBbXCJpZFwiXX0pYC5cbiAgICAvLyBUaGVzZSBsaW1pdCB0aGUgYXR0cmlidXRlcyBsb2FkZWQgZm9yIHByZWxvYWRlZCByZWxhdGlvbnNoaXAgdGFyZ2V0c1xuICAgIC8vIHJhdGhlciB0aGFuIHRoZSByb290IHF1ZXJ5J3MgU0VMRUNUIGNsYXVzZS5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChzZWxlY3QpKSB7XG4gICAgICB0aGlzLl9tZXJnZVByZWxvYWRTZWxlY3QodGhpcy5fcHJlbG9hZFNlbGVjdHMsIHNlbGVjdClcblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuc2VsZWN0KHNlbGVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZGVmYXVsdCBjb2x1bW5zIHBsdXMgdGhlIGdpdmVuIGV4dHJhIHNlbGVjdHMgZm9yIHByZWxvYWRlZFxuICAgKiByZWxhdGlvbnNoaXAgdGFyZ2V0cywga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUsIGUuZy5cbiAgICogYC5zZWxlY3RzRXh0cmEoe0FjY291bnQ6IFtcIihTRUxFQ1QgY291bnQoKikgRlJPTSBwcm9qZWN0cykgQVMgcHJvamVjdHNfY291bnRcIl19KWAuXG4gICAqIFVubGlrZSBgc2VsZWN0KHsuLi59KWAsIHdoaWNoIG5hcnJvd3MgdG8gb25seSB0aGUgbGlzdGVkIGNvbHVtbnMsIHRoaXMga2VlcHNcbiAgICogdGhlIGRlZmF1bHQgYFNFTEVDVCAqYCBjb2x1bW5zIGFuZCBhZGRzIHRoZSBleHRyYXMgb24gdG9wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gc2VsZWN0IC0gRXh0cmEgc2VsZWN0cyBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSwgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgc2VsZWN0c0V4dHJhKHNlbGVjdCkge1xuICAgIHRoaXMuX21lcmdlUHJlbG9hZFNlbGVjdCh0aGlzLl9wcmVsb2FkU2VsZWN0c0V4dHJhLCBzZWxlY3QpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyBhbiBvYmplY3QtZm9ybSBwcmVsb2FkIHNlbGVjdCAoa2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUpIGludG8gdGhlXG4gICAqIGdpdmVuIHRhcmdldCBtYXAsIGRlLWR1cGxpY2F0aW5nIGF0dHJpYnV0ZS9leHByZXNzaW9uIGVudHJpZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXQgLSBNYXAgdG8gbWVyZ2UgaW50by5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IHNlbGVjdCAtIE9iamVjdC1mb3JtIHNlbGVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21lcmdlUHJlbG9hZFNlbGVjdCh0YXJnZXQsIHNlbGVjdCkge1xuICAgIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMoc2VsZWN0KSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpID8gYXR0cmlidXRlcyA6IFthdHRyaWJ1dGVzXVxuXG4gICAgICBpZiAoIXRhcmdldFttb2RlbE5hbWVdKSB0YXJnZXRbbW9kZWxOYW1lXSA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICghdGFyZ2V0W21vZGVsTmFtZV0uaW5jbHVkZXMoYXR0cmlidXRlKSkgdGFyZ2V0W21vZGVsTmFtZV0ucHVzaChhdHRyaWJ1dGUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9vdCB0YWJsZSByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUm9vdCB0YWJsZSByZWZlcmVuY2UgZm9yIHF1ZXJ5IHNlbGVjdCBxdWFsaWZpY2F0aW9uLlxuICAgKi9cbiAgcm9vdFRhYmxlUmVmZXJlbmNlKCkge1xuICAgIGNvbnN0IGZyb21zID0gdGhpcy5nZXRGcm9tcygpXG4gICAgY29uc3QgbGFzdEZyb20gPSBmcm9tc1tmcm9tcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKGxhc3RGcm9tICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnRhYmxlTmFtZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkudGFibGVOYW1lXG4gICAgfVxuXG4gICAgaWYgKGxhc3RGcm9tICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnBsYWluID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCBwYXJzZWRSZWZlcmVuY2UgPSBwYXJzZUZyb21QbGFpblRhYmxlUmVmZXJlbmNlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkucGxhaW4pXG5cbiAgICAgIGlmIChwYXJzZWRSZWZlcmVuY2UpIHJldHVybiBwYXJzZWRSZWZlcmVuY2VcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7TUN9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwibW9kZWxDbGFzcyBub3Qgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSByZWxhdGlvbnNoaXAgdGFyZ2V0IHRvIHRoaXMgcXVlcnkncyBwaHlzaWNhbCBkYXRhYmFzZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIENhbm9uaWNhbCByZWxhdGlvbnNoaXAgdGFyZ2V0LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFF1ZXJ5LWJvdW5kIHJlbGF0aW9uc2hpcCB0YXJnZXQuXG4gICAqL1xuICBiaW5kTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2luIGJhc2UgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBqb2luIGJhc2UgcGF0aC5cbiAgICovXG4gIGdldEpvaW5CYXNlUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5fam9pbkJhc2VQYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbiB0cmFja2VyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9qb2luLXRyYWNrZXIuanNcIikuZGVmYXVsdH0gLSBUaGUgam9pbiB0cmFja2VyLlxuICAgKi9cbiAgZ2V0Sm9pblRyYWNrZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2pvaW5UcmFja2VyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZm9yY2UgcXVhbGlmeSBiYXNlIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIHF1YWxpZnkgYmFzZSB0YWJsZS5cbiAgICovXG4gIGdldEZvcmNlUXVhbGlmeUJhc2VUYWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgam9pbiBiYXNlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGpvaW5CYXNlUGF0aCAtIEpvaW4gYmFzZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgcXVlcnkgd2l0aCB1cGRhdGVkIGJhc2UgcGF0aC5cbiAgICovXG4gIHNldEpvaW5CYXNlUGF0aChqb2luQmFzZVBhdGgpIHtcbiAgICB0aGlzLl9qb2luQmFzZVBhdGggPSBqb2luQmFzZVBhdGhcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGpvaW5CYXNlUGF0aCAtIEpvaW4gYmFzZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHdpdGhKb2luUGF0aChqb2luQmFzZVBhdGgpIHtcbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLmNsb25lKCkpXG5cbiAgICBzY29wZWRRdWVyeS5fam9pbkJhc2VQYXRoID0gam9pbkJhc2VQYXRoXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5UcmFja2VyID0gdGhpcy5fam9pblRyYWNrZXJcblxuICAgIHJldHVybiBzY29wZWRRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0YWJsZSBuYW1lIGZvciBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGFibGUgbmFtZSBmb3IgcGF0aC5cbiAgICovXG4gIF9yZXNvbHZlVGFibGVOYW1lRm9ySm9pblBhdGgocGF0aCkge1xuICAgIHJldHVybiB0aGlzLl9yZXNvbHZlTW9kZWxDbGFzc0ZvckpvaW5QYXRoKHBhdGgpLnRhYmxlTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIG1vZGVsIGNsYXNzIGZvciBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgX3Jlc29sdmVNb2RlbENsYXNzRm9ySm9pblBhdGgocGF0aCkge1xuICAgIGxldCBtb2RlbENsYXNzID0gdGhpcy5fam9pblRyYWNrZXIuZ2V0Um9vdE1vZGVsQ2xhc3MoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHBhdGgpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICAgIH1cblxuICAgICAgbW9kZWxDbGFzcyA9IHRoaXMuYmluZE1vZGVsQ2xhc3ModGFyZ2V0TW9kZWxDbGFzcylcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7e3RhYmxlTmFtZTogc3RyaW5nLCBhbGlhczogc3RyaW5nIHwgdW5kZWZpbmVkfX0gLSBUaGUgZW50cnkuXG4gICAqL1xuICBfcmVnaXN0ZXJKb2luUGF0aChwYXRoKSB7XG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5fcmVzb2x2ZVRhYmxlTmFtZUZvckpvaW5QYXRoKHBhdGgpXG5cbiAgICByZXR1cm4gdGhpcy5fam9pblRyYWNrZXIucmVnaXN0ZXJQYXRoKHBhdGgsIHRhYmxlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2luIHRhYmxlIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBVbnF1b3RlZCB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpLlxuICAgKi9cbiAgZ2V0Sm9pblRhYmxlUmVmZXJlbmNlKHBhdGgpIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX2pvaW5UcmFja2VyLmdldEVudHJ5KHBhdGgpIHx8IHRoaXMuX3JlZ2lzdGVySm9pblBhdGgocGF0aClcblxuICAgIHJldHVybiBlbnRyeS5hbGlhcyB8fCBlbnRyeS50YWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSByZWZlcmVuY2UgZm9yIGpvaW4uXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBwYXRoIC0gSm9pbiBwYXRoIHNlZ21lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIHRhYmxlIHJlZmVyZW5jZSAoYWxpYXMgb3IgdGFibGUgbmFtZSkuXG4gICAqL1xuICBnZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aCkge1xuICAgIGNvbnN0IGZ1bGxQYXRoID0gdGhpcy5fam9pbkJhc2VQYXRoLmNvbmNhdChwYXRoKVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0Sm9pblRhYmxlUmVmZXJlbmNlKGZ1bGxQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGZvciBqb2luLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gcGF0aCAtIEpvaW4gcGF0aCBzZWdtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdW90ZWQgdGFibGUgbmFtZSBmb3Igam9pbiBwYXRoLlxuICAgKi9cbiAgZ2V0VGFibGVGb3JKb2luKC4uLnBhdGgpIHtcbiAgICByZXR1cm4gdGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0aGlzLmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wYXRoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yIHwgc3RyaW5nIHwgc3RyaW5nW119IHBhdGhPclNjb3BlRGVzY3JpcHRvciAtIFNjb3BlIGRlc2NyaXB0b3Igb3Igam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfSBbbWF5YmVTY29wZURlc2NyaXB0b3JdIC0gU2NvcGUgZGVzY3JpcHRvciB3aGVuIHBhdGggaXMgZ2l2ZW4uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHNjb3BlKHBhdGhPclNjb3BlRGVzY3JpcHRvciwgbWF5YmVTY29wZURlc2NyaXB0b3IpIHtcbiAgICBpZiAoaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihwYXRoT3JTY29wZURlc2NyaXB0b3IpICYmICFtYXliZVNjb3BlRGVzY3JpcHRvcikge1xuICAgICAgcmV0dXJuIHRoaXMuX2FwcGx5Um9vdFNjb3BlKHBhdGhPclNjb3BlRGVzY3JpcHRvcilcbiAgICB9XG5cbiAgICBpZiAoIW1heWJlU2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZShwYXRoLCBkZXNjcmlwdG9yKSByZXF1aXJlcyBhIHNjb3BlIGRlc2NyaXB0b3JcIilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbHlKb2luUGF0aFNjb3BlKHtcbiAgICAgIGpvaW5QYXRoOiBub3JtYWxpemVTY29wZVBhdGgoLyoqIEB0eXBlIHtzdHJpbmcgfCBzdHJpbmdbXX0gKi8gKHBhdGhPclNjb3BlRGVzY3JpcHRvcikpLFxuICAgICAgc2NvcGVEZXNjcmlwdG9yOiBtYXliZVNjb3BlRGVzY3JpcHRvclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSByb290IHNjb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfSBzY29wZURlc2NyaXB0b3IgLSBTY29wZSBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBTY29wZWQgcXVlcnkuXG4gICAqL1xuICBfYXBwbHlSb290U2NvcGUoc2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgaWYgKCFpc01vZGVsU2NvcGVEZXNjcmlwdG9yKHNjb3BlRGVzY3JpcHRvcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNjb3BlKCkgZXhwZWN0cyBhIGRlc2NyaXB0b3IgcmV0dXJuZWQgYnkgZGVmaW5lU2NvcGUoLi4uKS5zY29wZSguLi4pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVNb2RlbENsYXNzID0gYmFja2VuZFNjb3BlTW9kZWxDbGFzcyhzY29wZURlc2NyaXB0b3IpXG5cbiAgICBpZiAoc2NvcGVNb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpICE9PSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXBwbHkgJHtzY29wZURlc2NyaXB0b3IubW9kZWxDbGFzcy5uYW1lfSBzY29wZSB0byAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IHF1ZXJ5YClcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7dGhpcyB8IHZvaWR9ICovIChzY29wZURlc2NyaXB0b3IuY2FsbGJhY2soe1xuICAgICAgZHJpdmVyOiB0aGlzLmRyaXZlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLFxuICAgICAgcXVlcnk6IHRoaXMsXG4gICAgICB0YWJsZTogdGhpcy5yb290VGFibGVSZWZlcmVuY2UoKVxuICAgIH0sIC4uLnNjb3BlRGVzY3JpcHRvci5zY29wZUFyZ3MpKVxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5IHx8IHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGpvaW4gcGF0aCBzY29wZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2luLXBhdGggc2NvcGUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5qb2luUGF0aCAtIEpvaW4gcGF0aCByZWxhdGl2ZSB0byB0aGUgY3VycmVudCBxdWVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gYXJncy5zY29wZURlc2NyaXB0b3IgLSBTY29wZSBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBTY29wZWQgcXVlcnkuXG4gICAqL1xuICBfYXBwbHlKb2luUGF0aFNjb3BlKHtqb2luUGF0aCwgc2NvcGVEZXNjcmlwdG9yfSkge1xuICAgIGlmICghaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihzY29wZURlc2NyaXB0b3IpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZSgpIGV4cGVjdHMgYSBkZXNjcmlwdG9yIHJldHVybmVkIGJ5IGRlZmluZVNjb3BlKC4uLikuc2NvcGUoLi4uKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IGZ1bGxKb2luUGF0aCA9IHRoaXMuZ2V0Sm9pbkJhc2VQYXRoKCkuY29uY2F0KGpvaW5QYXRoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLl9yZXNvbHZlTW9kZWxDbGFzc0ZvckpvaW5QYXRoKGZ1bGxKb2luUGF0aClcblxuICAgIGNvbnN0IHNjb3BlTW9kZWxDbGFzcyA9IGJhY2tlbmRTY29wZU1vZGVsQ2xhc3Moc2NvcGVEZXNjcmlwdG9yKVxuXG4gICAgaWYgKHNjb3BlTW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSAhPT0gdGFyZ2V0TW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXBwbHkgJHtzY29wZURlc2NyaXB0b3IubW9kZWxDbGFzcy5uYW1lfSBzY29wZSB0byBqb2luIHBhdGggJHtmdWxsSm9pblBhdGguam9pbihcIi5cIil9ICgke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0pYClcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IHRoaXMuYnVpbGRKb2luU2NvcGVRdWVyeSh0YXJnZXRNb2RlbENsYXNzLCBmdWxsSm9pblBhdGgpXG4gICAgY29uc3Qgb3JpZ2luYWxKb2luQ291bnQgPSBzY29wZWRRdWVyeS5fam9pbnMubGVuZ3RoXG4gICAgY29uc3Qgb3JpZ2luYWxXaGVyZUNvdW50ID0gc2NvcGVkUXVlcnkuX3doZXJlcy5sZW5ndGhcbiAgICBjb25zdCBhcHBsaWVkUXVlcnkgPSAvKiogQHR5cGUge3R5cGVvZiBzY29wZWRRdWVyeSB8IHZvaWR9ICovIChzY29wZURlc2NyaXB0b3IuY2FsbGJhY2soe1xuICAgICAgZHJpdmVyOiBzY29wZWRRdWVyeS5kcml2ZXIsXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgcGF0aDogWy4uLmZ1bGxKb2luUGF0aF0sXG4gICAgICBxdWVyeTogc2NvcGVkUXVlcnksXG4gICAgICB0YWJsZTogc2NvcGVkUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKClcbiAgICB9LCAuLi5zY29wZURlc2NyaXB0b3Iuc2NvcGVBcmdzKSkgfHwgc2NvcGVkUXVlcnlcblxuICAgIGlmIChhcHBsaWVkUXVlcnkuZ2V0RnJvbXMoKS5sZW5ndGggIT09IHNjb3BlZFF1ZXJ5LmdldEZyb21zKCkubGVuZ3RoIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuZ2V0R3JvdXBzKCkubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5nZXRHcm91cHMoKS5sZW5ndGggfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5nZXRTZWxlY3RzKCkubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5nZXRTZWxlY3RzKCkubGVuZ3RoIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX29yZGVycy5sZW5ndGggIT09IHNjb3BlZFF1ZXJ5Ll9vcmRlcnMubGVuZ3RoIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX2xpbWl0ICE9PSBzY29wZWRRdWVyeS5fbGltaXQgfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fb2Zmc2V0ICE9PSBzY29wZWRRdWVyeS5fb2Zmc2V0IHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX3BhZ2UgIT09IHNjb3BlZFF1ZXJ5Ll9wYWdlIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX3BlclBhZ2UgIT09IHNjb3BlZFF1ZXJ5Ll9wZXJQYWdlIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX2Rpc3RpbmN0ICE9PSBzY29wZWRRdWVyeS5fZGlzdGluY3QgfHxcbiAgICAgIE9iamVjdC5rZXlzKGFwcGxpZWRRdWVyeS5fcHJlbG9hZCkubGVuZ3RoICE9PSBPYmplY3Qua2V5cyhzY29wZWRRdWVyeS5fcHJlbG9hZCkubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJKb2luZWQtcGF0aCBzY29wZXMgbWF5IG9ubHkgYWRkIHdoZXJlKC4uLikgYW5kIGpvaW5zKC4uLikgY2xhdXNlc1wiKVxuICAgIH1cblxuICAgIGlmIChhcHBsaWVkUXVlcnkuX2pvaW5zLmxlbmd0aCA+IG9yaWdpbmFsSm9pbkNvdW50KSB7XG4gICAgICBmb3IgKGNvbnN0IGpvaW4gb2YgYXBwbGllZFF1ZXJ5Ll9qb2lucy5zbGljZShvcmlnaW5hbEpvaW5Db3VudCkpIHtcbiAgICAgICAgaWYgKGpvaW4gaW5zdGFuY2VvZiBKb2luT2JqZWN0KSB7XG4gICAgICAgICAgdGhpcy5fam9pbnMucHVzaChuZXcgSm9pbk9iamVjdChqb2luLm9iamVjdCwgZnVsbEpvaW5QYXRoKSlcbiAgICAgICAgfSBlbHNlIGlmIChqb2luIGluc3RhbmNlb2YgSm9pblBsYWluKSB7XG4gICAgICAgICAgdGhpcy5fam9pbnMucHVzaChqb2luKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX2pvaW5zLnB1c2goam9pbilcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhcHBsaWVkUXVlcnkuX3doZXJlcy5sZW5ndGggPiBvcmlnaW5hbFdoZXJlQ291bnQpIHtcbiAgICAgIHRoaXMuX3doZXJlcy5wdXNoKC4uLmFwcGxpZWRRdWVyeS5fd2hlcmVzLnNsaWNlKG9yaWdpbmFsV2hlcmVDb3VudCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGpvaW4gc2NvcGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBqb2luUGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBzY29wZWQgam9pbiBxdWVyeS5cbiAgICovXG4gIGJ1aWxkSm9pblNjb3BlUXVlcnkodGFyZ2V0TW9kZWxDbGFzcywgam9pblBhdGgpIHtcbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovIChcbiAgICAgIHRoaXMuX29wZXJhdGlvblxuICAgICAgICA/IHRoaXMuX29wZXJhdGlvbi5mb3JNb2RlbCh0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgICA6IHRhcmdldE1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgICApXG5cbiAgICBzY29wZWRRdWVyeS5fam9pblRyYWNrZXIgPSB0aGlzLl9qb2luVHJhY2tlclxuICAgIHNjb3BlZFF1ZXJ5Ll9qb2luQmFzZVBhdGggPSBqb2luUGF0aFxuICAgIHNjb3BlZFF1ZXJ5Ll9mb3JjZVF1YWxpZnlCYXNlVGFibGUgPSB0cnVlXG5cbiAgICByZXR1cm4gc2NvcGVkUXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlc3Ryb3kgYWxsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveUFsbCgpIHtcbiAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgdGhpcy50b0FycmF5KClcblxuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBidWxrIFVQREFURSBvbiBhbGwgcm93cyBtYXRjaGluZyB0aGUgcXVlcnkncyBXSEVSRVxuICAgKiBjbGF1c2UuIEJ5cGFzc2VzIG1vZGVsIGxpZmVjeWNsZSBjYWxsYmFja3Mg4oCUIHVzZSB0aGlzIGZvclxuICAgKiBlZmZpY2llbnQgYmF0Y2ggdXBkYXRlcyB3aGVyZSBwZXItcm93IGhvb2tzIGFyZW4ndCBuZWVkZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lcyDihpIgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSB1cGRhdGUgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlQWxsKGRhdGEpIHtcbiAgICBjb25zdCBkcml2ZXIgPSB0aGlzLmRyaXZlclxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpXG4gICAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRhdGEpXG5cbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3Qgc2V0Q29scyA9IGVudHJpZXMubWFwKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoa2V5KVxuICAgICAgY29uc3QgcXVvdGVkID0gdmFsdWUgPT09IG51bGwgPyBcIk5VTExcIiA6IGRyaXZlci5xdW90ZSh2YWx1ZSlcblxuICAgICAgcmV0dXJuIGAke2RyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX0gPSAke3F1b3RlZH1gXG4gICAgfSkuam9pbihcIiwgXCIpXG5cbiAgICBjb25zdCBqb2luc1NxbCA9IG5ldyBKb2luc1BhcnNlcih7cHJldHR5OiBmYWxzZSwgcXVlcnk6IHRoaXN9KS50b1NxbCgpXG4gICAgY29uc3Qgd2hlcmVTcWwgPSBuZXcgV2hlcmVQYXJzZXIoe3ByZXR0eTogZmFsc2UsIHF1ZXJ5OiB0aGlzfSkudG9TcWwoKVxuICAgIGxldCBzcWxcblxuICAgIGlmIChqb2luc1NxbC5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBVc2UgYSBzdWJxdWVyeSBmb3IgY3Jvc3MtZHJpdmVyIGNvbXBhdGliaWxpdHkgKFNRTGl0ZVxuICAgICAgLy8gZG9lc24ndCBzdXBwb3J0IFVQREFURSAuLi4gSk9JTikuXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0udXBkYXRlQWxsKCkgd2l0aCBqb2luc2ApXG4gICAgICBjb25zdCBwayA9IGRyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KVxuICAgICAgY29uc3QgcXQgPSBkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpXG5cbiAgICAgIHNxbCA9IGBVUERBVEUgJHtxdH0gU0VUICR7c2V0Q29sc30gV0hFUkUgJHtwa30gSU4gKFNFTEVDVCAke3F0fS4ke3BrfSBGUk9NICR7cXR9JHtqb2luc1NxbH0ke3doZXJlU3FsfSlgXG4gICAgfSBlbHNlIHtcbiAgICAgIHNxbCA9IGBVUERBVEUgJHtkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfSBTRVQgJHtzZXRDb2xzfSR7d2hlcmVTcWx9YFxuICAgIH1cblxuICAgIGF3YWl0IGRyaXZlci5xdWVyeShzcWwsIHtsb2dOYW1lOiB0aGlzLnF1ZXJ5TG9nTmFtZShcIlVwZGF0ZSBBbGxcIiksIHNpZ25hbDogdGhpcy5fc2lnbmFsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHJlY29yZElkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaW5kLlxuICAgKi9cbiAgYXN5bmMgZmluZChyZWNvcmRJZCkge1xuICAgIC8qKlxuICAgICAqIENvbmRpdGlvbnMuXG4gICAgICogQHR5cGUge3tba2V5OiBzdHJpbmddOiBudW1iZXIgfCBzdHJpbmd9fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgT2JqZWN0LmFzc2lnbihjb25kaXRpb25zLCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgcmVjb3JkSWQpKVxuXG4gICAgY29uc3QgbmV3UXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgbmV3UXVlcnkud2hlcmUoY29uZGl0aW9ucylcblxuICAgIGNvbnN0IHJlY29yZCA9IChhd2FpdCBuZXdRdWVyeS5maXJzdCgpKVxuXG4gICAgaWYgKCFyZWNvcmQpIHtcbiAgICAgIHRocm93IG5ldyBSZWNvcmROb3RGb3VuZEVycm9yKGBDb3VsZG4ndCBmaW5kICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gd2l0aCAnJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCl9Jz0ke0pTT04uc3RyaW5naWZ5KHJlY29yZElkKX1gKVxuICAgIH1cblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBieS5cbiAgICovXG4gIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbmV3UXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgbmV3UXVlcnkud2hlcmUoY29uZGl0aW9ucylcblxuICAgIHJldHVybiBhd2FpdCBuZXdRdWVyeS5maXJzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGNyZWF0ZSBieS5cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHsoYXJnOiBJbnN0YW5jZVR5cGU8TUM+KSA9PiB2b2lkfSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG9yIGNyZWF0ZSBieS5cbiAgICovXG4gIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG5cbiAgICBpZiAocmVjb3JkLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIGF3YWl0IHJlY29yZC5zYXZlKClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5IG9yIGZhaWwuXG4gICAqL1xuICBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuZmluZEJ5KGNvbmRpdGlvbnMpXG5cbiAgICBpZiAoIXJlY29yZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVjb3JkIG5vdCBmb3VuZFwiKVxuICAgIH1cblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICovXG4gIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHRoaXMuZmluZEJ5KGNvbmRpdGlvbnMpXG5cbiAgICBpZiAocmVjb3JkKSByZXR1cm4gcmVjb3JkXG5cbiAgICBjb25zdCBuZXdSZWNvcmQgPSB0aGlzLmJ1aWxkKGNvbmRpdGlvbnMpXG5cbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIGNhbGxiYWNrKG5ld1JlY29yZClcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmVjb3JkIG93bmVkIGJ5IHRoZSBxdWVyeSdzIG9wZXJhdGlvbiwgd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPE1DPn0gLSBCdWlsdCByZWNvcmQuXG4gICAqL1xuICBidWlsZChhdHRyaWJ1dGVzID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxNQz59ICovIChuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKSlcblxuICAgIGlmICh0aGlzLl9vcGVyYXRpb24pIHRoaXMuX29wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmVjb3JkIG93bmVkIGJ5IHRoZSBxdWVyeSdzIG9wZXJhdGlvbiwgd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBDcmVhdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzID0ge30pIHtcbiAgICBjb25zdCByZWNvcmQgPSB0aGlzLmJ1aWxkKGF0dHJpYnV0ZXMpXG5cbiAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpcnN0LlxuICAgKi9cbiAgYXN5bmMgZmlyc3QoKSB7XG4gICAgY29uc3QgbmV3UXVlcnkgPSB0aGlzLmNsb25lKCkubGltaXQoMSkucmVvcmRlcihgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbih0aGlzLmdldE1vZGVsQ2xhc3MoKS5vcmRlcmFibGVDb2x1bW4oKSl9YClcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgbmV3UXVlcnkudG9BcnJheSgpXG5cbiAgICByZXR1cm4gcmVzdWx0c1swXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdC5cbiAgICovXG4gIGFzeW5jIGxhc3QoKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLm9yZGVyYWJsZUNvbHVtbigpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKClcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5jbG9uZSgpLnJlb3JkZXIoYCR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfSBERVNDYCkubGltaXQoMSkudG9BcnJheSgpXG5cbiAgICByZXR1cm4gcmVzdWx0c1swXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBwcmVsb2FkLlxuICAgKi9cbiAgcHJlbG9hZChkYXRhKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkUmVjb3JkKGRhdGEpXG4gICAgaW5jb3Jwb3JhdGUodGhpcy5fcHJlbG9hZCwgbm9ybWFsaXplZFByZWxvYWQpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBxdWVyeSByZXN1bHRzIGludG8gbW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxJbnN0YW5jZVR5cGU8TUM+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IG1vZGVscyA9IFtdXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBjb25zdCBtb2RlbCA9IHRoaXMuYnVpbGQoKVxuXG4gICAgICBtb2RlbC5sb2FkRXhpc3RpbmdSZWNvcmQocmVzdWx0KVxuICAgICAgbW9kZWxzLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyByZWNvcmQgc28gdGhhdFxuICAgIC8vIGF1dG8tcHJlbG9hZCBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICBtb2RlbC5fbG9hZENvaG9ydCA9IG1vZGVsc1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9wcmVsb2FkKS5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgUHJlbG9hZGVyKHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICBtb2RlbHMsXG4gICAgICAgIHByZWxvYWQ6IHRoaXMuX3ByZWxvYWQsXG4gICAgICAgIHByZWxvYWRTZWxlY3RzOiB0aGlzLl9wcmVsb2FkU2VsZWN0cyxcbiAgICAgICAgcHJlbG9hZFNlbGVjdHNFeHRyYTogdGhpcy5fcHJlbG9hZFNlbGVjdHNFeHRyYVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgcHJlbG9hZGVyLnJ1bigpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3dpdGhDb3VudC5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBydW5XaXRoQ291bnQoe1xuICAgICAgICBlbnRyaWVzOiB0aGlzLl93aXRoQ291bnQsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxzXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9xdWVyeURhdGEubGVuZ3RoID4gMCAmJiBtb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcnVuUXVlcnlEYXRhKHtcbiAgICAgICAgZW50cmllczogdGhpcy5fcXVlcnlEYXRhLFxuICAgICAgICByb290TW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICByb290TW9kZWxzOiBtb2RlbHNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIHF1ZXJ5IHJlc3VsdHMgdG8gYXJyYXkgb2YgbW9kZWwgaW5zdGFuY2VzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEluc3RhbmNlVHlwZTxNQz4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUGx1Y2tzIG9uZSBvciBtb3JlIGNvbHVtbnMgZGlyZWN0bHkgZnJvbSB0aGUgZGF0YWJhc2Ugd2l0aG91dCBpbnN0YW50aWF0aW5nIG1vZGVscy5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd8c3RyaW5nW119IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcGx1Y2suXG4gICAqL1xuICBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgY29uc3QgZmxhdENvbHVtbnMgPSBjb2x1bW5zLmZsYXQoKVxuXG4gICAgaWYgKGZsYXRDb2x1bW5zLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFibGVOYW1lID0gbW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBmbGF0Q29sdW1ucy5tYXAoKGNvbHVtbikgPT4gYXR0cmlidXRlTWFwW2NvbHVtbl0gfHwgY29sdW1uKVxuXG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgcXVlcnkuX3ByZWxvYWQgPSB7fVxuICAgIHF1ZXJ5Ll9zZWxlY3RzID0gW11cblxuICAgIGNvbHVtbk5hbWVzLmZvckVhY2goKGNvbHVtbk5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHNlbGVjdFNxbCA9IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgIHF1ZXJ5LnNlbGVjdChzZWxlY3RTcWwpXG4gICAgfSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5fZXhlY3V0ZVF1ZXJ5KHtsb2dOYW1lOiBxdWVyeS5xdWVyeUxvZ05hbWUoXCJQbHVja1wiKX0pXG5cbiAgICBpZiAoY29sdW1uTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBbY29sdW1uTmFtZV0gPSBjb2x1bW5OYW1lc1xuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVtjb2x1bW5OYW1lXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgcm93SGFzaCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICByZXR1cm4gY29sdW1uTmFtZXMubWFwKChjb2x1bW5OYW1lKSA9PiByb3dIYXNoW2NvbHVtbk5hbWVdKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmUod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZSh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVNb2RlbENsYXNzSGFzaCh7XG4gICAgICAgICAgaGFzaDogcmVzb2x2ZWRIYXNoLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLFxuICAgICAgICAgIHF1YWxpZnlCYXNlVGFibGUsXG4gICAgICAgICAgcXVlcnk6IHRoaXNcbiAgICAgICAgfSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhmYWxsYmFja0hhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3VwZXIud2hlcmUoZmFsbGJhY2tIYXNoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0eXBlIG9mIHdoZXJlOiAke3R5cGVvZiB3aGVyZX0gKCR7d2hlcmUuY29uc3RydWN0b3IubmFtZX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLiBTdXBwb3J0cyBgc2Aga2V5IGZvciBzb3J0aW5nIChlLmcuLCBge3M6IFwibmFtZSBhc2NcIn1gKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYW5kIHNvcnQgYXBwbGllZC5cbiAgICovXG4gIHJhbnNhY2socGFyYW1zKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSBwYXJhbXNcbiAgICBjb25zdCBncm91cCA9IG5vcm1hbGl6ZVJhbnNhY2tHcm91cCh0aGlzLmdldE1vZGVsQ2xhc3MoKSwgZmlsdGVyUGFyYW1zKVxuXG4gICAgYXBwbHlSYW5zYWNrR3JvdXAoe2dyb3VwLCBxdWVyeTogdGhpc30pXG5cbiAgICBpZiAodHlwZW9mIHMgPT09IFwic3RyaW5nXCIgJiYgcy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc29ydHMgPSBwYXJzZVJhbnNhY2tTb3J0KHRoaXMuZ2V0TW9kZWxDbGFzcygpLCBzKVxuXG4gICAgICBmb3IgKGNvbnN0IHNvcnREZWYgb2Ygc29ydHMpIHtcbiAgICAgICAgdGhpcy5vcmRlcih7Y29sdW1uOiBzb3J0RGVmLmF0dHJpYnV0ZSwgZGlyZWN0aW9uOiBzb3J0RGVmLmRpcmVjdGlvbn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlIG5vdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmVOb3Qod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZU5vdCh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVOb3QobmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgICAgICAgIGhhc2g6IHJlc29sdmVkSGFzaCxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKSxcbiAgICAgICAgICBxdWFsaWZ5QmFzZVRhYmxlLFxuICAgICAgICAgIHF1ZXJ5OiB0aGlzXG4gICAgICAgIH0pKSlcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGZhbGxiYWNrSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBzdXBlci53aGVyZU5vdChmYWxsYmFja0hhc2gpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHR5cGUgb2Ygd2hlcmU6ICR7dHlwZW9mIHdoZXJlfSAoJHt3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgbG9nIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBRdWVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVlcnkgbG9nIG5hbWUuXG4gICAqL1xuICBxdWVyeUxvZ05hbWUob3BlcmF0aW9uKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9ICR7b3BlcmF0aW9ufWBcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyB0aGlzIHF1ZXJ5IGFzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGN1cnJlbnRTeW5jQ2xpZW50KCkuc3luYyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoaXMgcXVlcnkncyBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY29wZSBpcyBkZWFjdGl2YXRlZC5cbiAgICovXG4gIGFzeW5jIHVuc3luYygpIHtcbiAgICBhd2FpdCBjdXJyZW50U3luY0NsaWVudCgpLnVuc3luYyh0aGlzKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSByYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tHcm91cH0gYXJncy5ncm91cCAtIE5vcm1hbGl6ZWQgUmFuc2FjayBncm91cC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5UmFuc2Fja0dyb3VwKHtncm91cCwgcXVlcnl9KSB7XG4gIGNvbnN0IHdoZXJlID0gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSlcblxuICBpZiAod2hlcmUpIHtcbiAgICBxdWVyeS5fd2hlcmVzLnB1c2god2hlcmUpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgZ3JvdXAgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBhcmdzLmdyb3VwIC0gTm9ybWFsaXplZCBSYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIENvbWJpbmVkIHdoZXJlIGNsYXVzZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSkge1xuICAvKipcbiAgICogV2hlcmVzLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgY29uc3Qgd2hlcmVzID0gW11cblxuICBmb3IgKGNvbnN0IGNvbmRpdGlvbiBvZiBncm91cC5jb25kaXRpb25zKSB7XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pXG5cbiAgICBpZiAod2hlcmUpIHdoZXJlcy5wdXNoKHdoZXJlKVxuICB9XG5cbiAgZm9yIChjb25zdCBncm91cGluZyBvZiBncm91cC5ncm91cGluZ3MpIHtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkUmFuc2Fja0dyb3VwV2hlcmUoe2dyb3VwOiBncm91cGluZywgcXVlcnl9KVxuXG4gICAgaWYgKHdoZXJlKSB3aGVyZXMucHVzaCh3aGVyZSlcbiAgfVxuXG4gIGlmICh3aGVyZXMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcbiAgaWYgKHdoZXJlcy5sZW5ndGggPT09IDEpIHJldHVybiB3aGVyZXNbMF1cblxuICByZXR1cm4gbmV3IFdoZXJlQ29tYmluYXRvcih7XG4gICAgY29tYmluYXRvcjogZ3JvdXAuY29tYmluYXRvcixcbiAgICBxdWVyeSxcbiAgICB3aGVyZXNcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgY29uZGl0aW9uIHdoZXJlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBDb25kaXRpb24gd2hlcmUgY2xhdXNlLlxuICovXG5mdW5jdGlvbiBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pIHtcbiAgLyoqXG4gICAqIFdoZXJlcy5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gIGNvbnN0IHdoZXJlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgY29uZGl0aW9uLmF0dHJpYnV0ZXMpIHtcbiAgICB3aGVyZXMucHVzaChidWlsZFJhbnNhY2tBdHRyaWJ1dGVXaGVyZSh7YXR0cmlidXRlLCBjb25kaXRpb24sIHF1ZXJ5fSkpXG4gIH1cblxuICBpZiAod2hlcmVzLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG4gIGlmICh3aGVyZXMubGVuZ3RoID09PSAxKSByZXR1cm4gd2hlcmVzWzBdXG5cbiAgcmV0dXJuIG5ldyBXaGVyZUNvbWJpbmF0b3Ioe1xuICAgIGNvbWJpbmF0b3I6IGNvbmRpdGlvbi5jb21iaW5hdG9yLFxuICAgIHF1ZXJ5LFxuICAgIHdoZXJlc1xuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0fSAtIEF0dHJpYnV0ZSB3aGVyZSBjbGF1c2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZVdoZXJlKHthdHRyaWJ1dGUsIGNvbmRpdGlvbiwgcXVlcnl9KSB7XG4gIGNvbnN0IGhhc2ggPSBidWlsZFJhbnNhY2tBdHRyaWJ1dGVIYXNoKHthdHRyaWJ1dGUsIGNvbmRpdGlvbn0pXG4gIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoLCBtb2RlbENsYXNzOiBxdWVyeS5nZXRNb2RlbENsYXNzKCl9KVxuXG4gIGlmIChPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwKSB7XG4gICAgcXVlcnkuam9pbnMoam9pbk9iamVjdClcbiAgfVxuXG4gIGNvbnN0IHdoZXJlID0gbmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgIGhhc2gsXG4gICAgbW9kZWxDbGFzczogcXVlcnkuZ2V0TW9kZWxDbGFzcygpLFxuICAgIHF1YWxpZnlCYXNlVGFibGU6IHRydWUsXG4gICAgcXVlcnlcbiAgfSlcblxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJub3RfZXFcIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9pblwiKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIiAmJiAhY29uZGl0aW9uLnZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIHJldHVybiB3aGVyZVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gYXJncy5jb25kaXRpb24gLSBOb3JtYWxpemVkIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZUhhc2goe2F0dHJpYnV0ZSwgY29uZGl0aW9ufSkge1xuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJlcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiaW5cIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9lcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibm90X2luXCIpIHtcbiAgICByZXR1cm4gYnVpbGROZXN0ZWRSYW5zYWNrSGFzaCh7YXR0cmlidXRlLCB2YWx1ZTogY29uZGl0aW9uLnZhbHVlfSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIikge1xuICAgIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tIYXNoKHthdHRyaWJ1dGUsIHZhbHVlOiBudWxsfSlcbiAgfVxuXG4gIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe1xuICAgIGF0dHJpYnV0ZSxcbiAgICBvcGVyYXRvcjogcmFuc2Fja1R1cGxlT3BlcmF0b3IoY29uZGl0aW9uLnByZWRpY2F0ZSksXG4gICAgdmFsdWU6IHJhbnNhY2tUdXBsZVZhbHVlKGNvbmRpdGlvbilcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIEZpbmFsIHZhbHVlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTmVzdGVkUmFuc2Fja0hhc2goe2F0dHJpYnV0ZSwgdmFsdWV9KSB7XG4gIC8qKlxuICAgKiBIYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgaGFzaCA9IHtbYXR0cmlidXRlLmF0dHJpYnV0ZU5hbWVdOiB2YWx1ZX1cblxuICBmb3IgKGxldCBpbmRleCA9IGF0dHJpYnV0ZS5wYXRoLmxlbmd0aCAtIDE7IGluZGV4ID49IDA7IGluZGV4IC09IDEpIHtcbiAgICBoYXNoID0ge1thdHRyaWJ1dGUucGF0aFtpbmRleF1dOiBoYXNofVxuICB9XG5cbiAgcmV0dXJuIGhhc2hcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIHR1cGxlIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IGFyZ3Mub3BlcmF0b3IgLSBUdXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBGaW5hbCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTmVzdGVkIHR1cGxlIGhhc2ggc3VpdGFibGUgZm9yIHF1ZXJ5LndoZXJlLlxuICovXG5mdW5jdGlvbiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe2F0dHJpYnV0ZSwgb3BlcmF0b3IsIHZhbHVlfSkge1xuICAvKipcbiAgICogSGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IGhhc2ggPSB7XG4gICAgW2F0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lXTogW1thdHRyaWJ1dGUuYXR0cmlidXRlTmFtZSwgb3BlcmF0b3IsIHZhbHVlXV1cbiAgfVxuXG4gIGZvciAobGV0IGluZGV4ID0gYXR0cmlidXRlLnBhdGgubGVuZ3RoIC0gMTsgaW5kZXggPj0gMDsgaW5kZXggLT0gMSkge1xuICAgIGhhc2ggPSB7W2F0dHJpYnV0ZS5wYXRoW2luZGV4XV06IGhhc2h9XG4gIH1cblxuICByZXR1cm4gaGFzaFxufVxuXG4vKipcbiAqIFJ1bnMgcmFuc2FjayB0dXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrUHJlZGljYXRlfSBwcmVkaWNhdGUgLSBSYW5zYWNrIHByZWRpY2F0ZS5cbiAqIEByZXR1cm5zIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IC0gUXVlcnkgdHVwbGUgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIHJhbnNhY2tUdXBsZU9wZXJhdG9yKHByZWRpY2F0ZSkge1xuICBpZiAocHJlZGljYXRlID09PSBcImd0XCIgfHwgcHJlZGljYXRlID09PSBcImd0ZXFcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRlcVwiKSB7XG4gICAgcmV0dXJuIHByZWRpY2F0ZVxuICB9XG5cbiAgcmV0dXJuIFwibGlrZVwiXG59XG5cbi8qKlxuICogUnVucyByYW5zYWNrIHR1cGxlIHZhbHVlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGNvbmRpdGlvbiAtIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFF1ZXJ5IHR1cGxlIHZhbHVlLlxuICovXG5mdW5jdGlvbiByYW5zYWNrVHVwbGVWYWx1ZShjb25kaXRpb24pIHtcbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiY29udFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX0lYFxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJzdGFydFwiKSByZXR1cm4gYCR7Y29uZGl0aW9uLnZhbHVlfSVgXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcImVuZFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX1gXG5cbiAgcmV0dXJuIGNvbmRpdGlvbi52YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByZWxhdGlvbnNoaXAuXG4gKi9cbmZ1bmN0aW9uIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShtb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lKSB7XG4gIHJldHVybiBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gQXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgcmVzb2x2ZWQgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICBjb25zdCBhdHRyaWJ1dGVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gIGlmIChhdHRyaWJ1dGVNYXBba2V5XSkgcmV0dXJuIGF0dHJpYnV0ZU1hcFtrZXldXG5cbiAgY29uc3QgY29sdW1uTWFwID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgY29uc3QgdW5kZXJzY29yZWQgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoa2V5KVxuXG4gIHJldHVybiBjb2x1bW5NYXBba2V5XSB8fCBjb2x1bW5NYXBbdW5kZXJzY29yZWRdIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJ1bnMgc3BsaXQgd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3tyZXNvbHZlZEhhc2g6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZmFsbGJhY2tIYXNoOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAtIFNwbGl0IGhhc2hlcy5cbiAqL1xuZnVuY3Rpb24gc3BsaXRXaGVyZUhhc2goe2hhc2gsIG1vZGVsQ2xhc3N9KSB7XG4gIC8qKlxuICAgKiBSZXNvbHZlZCBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCByZXNvbHZlZEhhc2ggPSB7fVxuICAvKipcbiAgICogRmFsbGJhY2sgaGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgZmFsbGJhY2tIYXNoID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCBpc05lc3RlZCA9IGlzUGxhaW5PYmplY3QodmFsdWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG1vZGVsQ2xhc3MsIGtleSlcblxuICAgIGlmIChpc05lc3RlZCkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcCkge1xuICAgICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc3VsdCA9IHNwbGl0V2hlcmVIYXNoKHtoYXNoOiB2YWx1ZSwgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc30pXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc29sdmVkS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5yZXNvbHZlZEhhc2gpXG4gICAgICAgIGNvbnN0IG5lc3RlZEZhbGxiYWNrS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5mYWxsYmFja0hhc2gpXG5cbiAgICAgICAgaWYgKG5lc3RlZFJlc29sdmVkS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmVzb2x2ZWRIYXNoW2tleV0gPSBuZXN0ZWRSZXN1bHQucmVzb2x2ZWRIYXNoXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkRmFsbGJhY2tLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0YXJnZXRNb2RlbENsYXNzLnRhYmxlTmFtZSgpXG5cbiAgICAgICAgICBpZiAoIWZhbGxiYWNrSGFzaFt0YWJsZU5hbWVdKSBmYWxsYmFja0hhc2hbdGFibGVOYW1lXSA9IHt9XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihmYWxsYmFja0hhc2hbdGFibGVOYW1lXSwgbmVzdGVkUmVzdWx0LmZhbGxiYWNrSGFzaClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2tIYXNoW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwICYmIGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICByZXNvbHZlZEhhc2hba2V5XSA9IG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSB7XG4gICAgICAgIHJlc29sdmVkSGFzaFtjb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGpvaW4gb2JqZWN0IGZyb20gd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBKb2luIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaCwgbW9kZWxDbGFzc30pIHtcbiAgLyoqXG4gICAqIEpvaW4gb2JqZWN0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBqb2luT2JqZWN0ID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBnZXRSZWxhdGlvbnNoaXBCeU5hbWUobW9kZWxDbGFzcywga2V5KVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIGNvbnRpbnVlXG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG4gICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCBuZXN0ZWRKb2luT2JqZWN0ID0gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaDogdmFsdWUsIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgICBqb2luT2JqZWN0W2tleV0gPSBPYmplY3Qua2V5cyhuZXN0ZWRKb2luT2JqZWN0KS5sZW5ndGggPiAwID8gbmVzdGVkSm9pbk9iamVjdCA6IHRydWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICBqb2luT2JqZWN0W2tleV0gPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGpvaW5PYmplY3Rcbn1cblxuY29uc3QgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibm90RXFcIiwgXCJndFwiLCBcImd0ZXFcIiwgXCJsdFwiLCBcImx0ZXFcIiwgXCJsaWtlXCIsIFwiPlwiLCBcIj49XCIsIFwiPFwiLCBcIjw9XCJdKVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRvciAtIFJhdyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcmV0dXJucyB7XCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwifSAtIE5vcm1hbGl6ZWQgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gKi8gKFxuICAgIG9wZXJhdG9yQWxpYXNlc1svKiogQHR5cGUge1wiPFwiIHwgXCI8PVwiIHwgXCI+XCIgfCBcIj49XCJ9ICovIChvcGVyYXRvcildIHx8IG9wZXJhdG9yXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHR1cGxlVmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgaXMgYSByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUuXG4gKi9cbmZ1bmN0aW9uIGlzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKHR1cGxlVmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHR1cGxlVmFsdWUpIHx8IHR1cGxlVmFsdWUubGVuZ3RoIDwgMykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIHR5cGVvZiB0dXBsZVZhbHVlWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgdHlwZW9mIHR1cGxlVmFsdWVbMV0gPT09IFwic3RyaW5nXCIgJiZcbiAgICByZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9ycy5oYXModHVwbGVWYWx1ZVsxXSlcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59IC0gTm9ybWFsaXplZCB0dXBsZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIHR5cGU6ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge0FycmF5PFtzdHJpbmcsIFwiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIiwgdW5rbm93bl0+fSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cbiAgICAvKipcbiAgICAgKiBBZGQgY29uZGl0aW9uLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvblZhbHVlIC0gQ2FuZGlkYXRlIG5lc3RlZCBjb25kaXRpb24uXG4gICAgICovXG4gICAgY29uc3QgYWRkQ29uZGl0aW9uID0gKGNvbmRpdGlvblZhbHVlKSA9PiB7XG4gICAgICBpZiAoaXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGUoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHR1cGxlID0gLyoqIEB0eXBlIHtbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwiLCB1bmtub3duLCAuLi5BcnJheTx1bmtub3duPl19ICovIChjb25kaXRpb25WYWx1ZSlcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcih0dXBsZVsxXSlcblxuICAgICAgICBub3JtYWxpemVkLnB1c2goW1xuICAgICAgICAgIHR1cGxlWzBdLFxuICAgICAgICAgIG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgICAgICB0dXBsZVsyXVxuICAgICAgICBdKVxuXG4gICAgICAgIGlmICh0dXBsZS5sZW5ndGggPiAzKSB7XG4gICAgICAgICAgZm9yIChsZXQgaW5kZXggPSAzOyBpbmRleCA8IHR1cGxlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICAgICAgYWRkQ29uZGl0aW9uKHR1cGxlW2luZGV4XSlcbiAgICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShjb25kaXRpb25WYWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlbGF0aW9uc2hpcCB3aGVyZSBjb25kaXRpb25zIG11c3QgYmUgdHVwbGVzXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25kaXRpb25WYWx1ZSkuZm9yRWFjaCgobmVzdGVkQ29uZGl0aW9uVmFsdWUpID0+IHtcbiAgICAgIGFkZENvbmRpdGlvbihuZXN0ZWRDb25kaXRpb25WYWx1ZSlcbiAgICB9KVxuICB9XG5cbiAgYWRkQ29uZGl0aW9uKHZhbHVlKVxuXG4gIGlmIChub3JtYWxpemVkLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIGNhbm5vdCBiZSBlbXB0eVwiKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIGhhcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVsYXRpb25zaGlwIHdoZXJlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBjYW4gYmUgbm9ybWFsaXplZCB0byByZWxhdGlvbnNoaXAgdHVwbGVzLlxuICovXG5mdW5jdGlvbiBoYXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSB7XG4gIHRyeSB7XG4gICAgbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh2YWx1ZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG4iXX0=