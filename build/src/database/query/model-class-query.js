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
        const newQuery = this.clone().limit(1).reorder(this._defaultIdentityOrder("ASC"));
        const results = await newQuery.toArray();
        return results[0] || null;
    }
    /**
     * Runs last.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the last.
     */
    async last() {
        const results = await this.clone().reorder(this._defaultIdentityOrder("DESC")).limit(1).toArray();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtY2xhc3MtcXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLGlCQUFpQixDQUFBO0FBQzdDLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLG9DQUFvQyxDQUFBO0FBQ3BFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sU0FBUyxNQUFNLGdCQUFnQixDQUFBO0FBQ3RDLE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxZQUFZLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsWUFBWSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sWUFBWSxDQUFBO0FBQ3RDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sbUJBQW1CLE1BQU0scUNBQXFDLENBQUE7QUFDckUsT0FBTyxFQUFDLHFCQUFxQixFQUFFLGdCQUFnQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDOUUsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDakUsT0FBTyxFQUFDLHlCQUF5QixFQUFFLHFCQUFxQixFQUFDLE1BQU0sa0NBQWtDLENBQUE7QUFDakcsT0FBTyxlQUFlLE1BQU0sdUJBQXVCLENBQUE7QUFDbkQsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFP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QUMsQ0FBQTtRQUUvQyxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFBQyxNQUFNLENBQUM7UUFDUCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7aW5jb3Jwb3JhdGV9IGZyb20gXCJpbmNvcnBvcmF0b3JcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQge2lzUGxhaW5PYmplY3R9IGZyb20gXCJpcy1wbGFpbi1vYmplY3RcIlxuaW1wb3J0IHtjdXJyZW50U3luY0NsaWVudH0gZnJvbSBcIi4uLy4uL3N5bmMvc3luYy1jbGllbnQtcmVnaXN0cnkuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBQcmVsb2FkZXIgZnJvbSBcIi4vcHJlbG9hZGVyLmpzXCJcbmltcG9ydCB7bm9ybWFsaXplUXVlcnlEYXRhU3BlYywgcnVuUXVlcnlEYXRhfSBmcm9tIFwiLi9xdWVyeS1kYXRhLmpzXCJcbmltcG9ydCB7bm9ybWFsaXplV2l0aENvdW50LCBydW5XaXRoQ291bnR9IGZyb20gXCIuL3dpdGgtY291bnQuanNcIlxuaW1wb3J0IERhdGFiYXNlUXVlcnkgZnJvbSBcIi4vaW5kZXguanNcIlxuaW1wb3J0IEpvaW5PYmplY3QgZnJvbSBcIi4vam9pbi1vYmplY3QuanNcIlxuaW1wb3J0IEpvaW5QbGFpbiBmcm9tIFwiLi9qb2luLXBsYWluLmpzXCJcbmltcG9ydCBKb2luVHJhY2tlciBmcm9tIFwiLi9qb2luLXRyYWNrZXIuanNcIlxuaW1wb3J0IFJlY29yZE5vdEZvdW5kRXJyb3IgZnJvbSBcIi4uL3JlY29yZC9yZWNvcmQtbm90LWZvdW5kLWVycm9yLmpzXCJcbmltcG9ydCB7bm9ybWFsaXplUmFuc2Fja0dyb3VwLCBwYXJzZVJhbnNhY2tTb3J0fSBmcm9tIFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiXG5pbXBvcnQge2lzTW9kZWxTY29wZURlc2NyaXB0b3J9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHNjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCBXaGVyZUNvbWJpbmF0b3IgZnJvbSBcIi4vd2hlcmUtY29tYmluYXRvci5qc1wiXG5pbXBvcnQgV2hlcmVNb2RlbENsYXNzSGFzaCBmcm9tIFwiLi93aGVyZS1tb2RlbC1jbGFzcy1oYXNoLmpzXCJcbmltcG9ydCBXaGVyZU5vdCBmcm9tIFwiLi93aGVyZS1ub3QuanNcIlxuaW1wb3J0IEpvaW5zUGFyc2VyIGZyb20gXCIuLi9xdWVyeS1wYXJzZXIvam9pbnMtcGFyc2VyLmpzXCJcbmltcG9ydCBXaGVyZVBhcnNlciBmcm9tIFwiLi4vcXVlcnktcGFyc2VyL3doZXJlLXBhcnNlci5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW01DPXR5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLlF1ZXJ5QXJnc1R5cGUgJiB7bW9kZWxDbGFzczogTUMsIGpvaW5CYXNlUGF0aD86IHN0cmluZ1tdLCBqb2luVHJhY2tlcj86IGltcG9ydChcIi4vam9pbi10cmFja2VyLmpzXCIpLmRlZmF1bHQsIGZvcmNlUXVhbGlmeUJhc2VUYWJsZT86IGJvb2xlYW4sIHdpdGhDb3VudD86IGltcG9ydChcIi4vd2l0aC1jb3VudC5qc1wiKS5XaXRoQ291bnRFbnRyeVtdLCBxdWVyeURhdGE/OiBpbXBvcnQoXCIuL3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRW50cnlbXSwgb3BlcmF0aW9uPzogaW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBNb2RlbENsYXNzUXVlcnlBcmdzVHlwZVxuICovXG4vKipcbiAqIFJ1bnMgdW5xdW90ZSBzcWwgaWRlbnRpZmllci5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFBvdGVudGlhbGx5IHF1b3RlZCBTUUwgaWRlbnRpZmllci5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVW5xdW90ZWQgaWRlbnRpZmllci5cbiAqL1xuZnVuY3Rpb24gdW5xdW90ZVNxbElkZW50aWZpZXIodmFsdWUpIHtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+PSAyICYmICgodHJpbW1lZC5zdGFydHNXaXRoKFwiYFwiKSAmJiB0cmltbWVkLmVuZHNXaXRoKFwiYFwiKSkgfHwgKHRyaW1tZWQuc3RhcnRzV2l0aChcIlxcXCJcIikgJiYgdHJpbW1lZC5lbmRzV2l0aChcIlxcXCJcIikpKSkge1xuICAgIHJldHVybiB0cmltbWVkLnNsaWNlKDEsIC0xKVxuICB9XG5cbiAgaWYgKHRyaW1tZWQubGVuZ3RoID49IDIgJiYgdHJpbW1lZC5zdGFydHNXaXRoKFwiW1wiKSAmJiB0cmltbWVkLmVuZHNXaXRoKFwiXVwiKSkge1xuICAgIHJldHVybiB0cmltbWVkLnNsaWNlKDEsIC0xKVxuICB9XG5cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuLyoqXG4gKiBSdW5zIHBhcnNlIGZyb20gcGxhaW4gdGFibGUgcmVmZXJlbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGZyb21QbGFpbiAtIEZST00gY2xhdXNlIHNvdXJjZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFBhcnNlZCB0YWJsZSByZWZlcmVuY2Ugb3IgbnVsbCB3aGVuIHVuc3VwcG9ydGVkLlxuICovXG5mdW5jdGlvbiBwYXJzZUZyb21QbGFpblRhYmxlUmVmZXJlbmNlKGZyb21QbGFpbikge1xuICBjb25zdCB0cmltbWVkID0gZnJvbVBsYWluLnRyaW0oKVxuXG4gIGlmICh0cmltbWVkLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG5cbiAgY29uc3QgYWxpYXNNYXRjaCA9IHRyaW1tZWQubWF0Y2goLyg/Ol58XFxzKSg/OkFTXFxzKyk/KFtgXCJdP1thLXpBLVpfXVthLXpBLVowLTlfXSpbYFwiXT98XFxbW2EtekEtWl9dW2EtekEtWjAtOV9dKlxcXSlcXHMqJC9pKVxuXG4gIGlmICghYWxpYXNNYXRjaCB8fCAhYWxpYXNNYXRjaFsxXSkgcmV0dXJuIG51bGxcblxuICByZXR1cm4gdW5xdW90ZVNxbElkZW50aWZpZXIoYWxpYXNNYXRjaFsxXSlcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBzY29wZSBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gcGF0aCAtIFNjb3BlIHBhdGggaW5wdXQuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCBwYXRoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTY29wZVBhdGgocGF0aCkge1xuICBpZiAodHlwZW9mIHBhdGggPT09IFwic3RyaW5nXCIpIHtcbiAgICBpZiAocGF0aC5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTY29wZSBwYXRoIHN0cmluZ3MgbXVzdCBiZSBub24tZW1wdHlcIilcblxuICAgIHJldHVybiBbcGF0aF1cbiAgfVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShwYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzY29wZSBwYXRoIHR5cGU6ICR7dHlwZW9mIHBhdGh9YClcbiAgfVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcGF0aCkge1xuICAgIGlmICh0eXBlb2YgZW50cnkgIT09IFwic3RyaW5nXCIgfHwgZW50cnkubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2NvcGUgcGF0aCBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3NcIilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gWy4uLnBhdGhdXG59XG5cbi8qKlxuICogTmFycm93cyBhIHNoYXJlZCBtb2RlbC1zY29wZSBkZXNjcmlwdG9yIHRvIHRoZSBiYWNrZW5kIG1vZGVsIGNsYXNzIHJlcXVpcmVkIGJ5IE1vZGVsQ2xhc3NRdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IHNjb3BlRGVzY3JpcHRvciAtIFNoYXJlZCBzY29wZSBkZXNjcmlwdG9yLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBCYWNrZW5kIHNjb3BlIG93bmVyLlxuICovXG5mdW5jdGlvbiBiYWNrZW5kU2NvcGVNb2RlbENsYXNzKHNjb3BlRGVzY3JpcHRvcikge1xuICBjb25zdCBtb2RlbENsYXNzID0gc2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3NcblxuICBpZiAoIShcImNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzc1wiIGluIG1vZGVsQ2xhc3MpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQSBmcm9udGVuZC1tb2RlbCBzY29wZSBjYW5ub3QgYmUgYXBwbGllZCB0byBhIGRhdGFiYXNlIHJlY29yZCBxdWVyeVwiKVxuICB9XG5cbiAgLy8gVGhlIHJ1bnRpbWUgbWVtYmVyIGNoZWNrIGFib3ZlIG5hcnJvd3MgdGhlIHNoYXJlZCBmcm9udGVuZC9iYWNrZW5kIGRlc2NyaXB0b3IgYm91bmRhcnkuXG4gIHJldHVybiAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsQ2xhc3MpXG59XG5cbi8qKlxuICogRGVlcC1jb3BpZXMgYSBwcmVsb2FkIHNlbGVjdCBtYXAgKGtleWVkIGJ5IG1vZGVsIG5hbWUgd2l0aCBhdHRyaWJ1dGUgYXJyYXlzKVxuICogc28gYSBjbG9uZWQgcXVlcnkncyBzZWxlY3Rpb25zIGNhbiBiZSBtdXRhdGVkIHdpdGhvdXQgYWZmZWN0aW5nIHRoZSBvcmlnaW5hbC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBtYXAgLSBQcmVsb2FkIHNlbGVjdCBtYXAgdG8gY29weS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IC0gQSBjb3B5IHdpdGggaW5kZXBlbmRlbnQgYXJyYXlzLlxuICovXG5mdW5jdGlvbiBjbG9uZVByZWxvYWRTZWxlY3RNYXAobWFwKSB7XG4gIC8qKlxuICAgKiBSZXN1bHQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhtYXApKSB7XG4gICAgcmVzdWx0W21vZGVsTmFtZV0gPSBbLi4uYXR0cmlidXRlc11cbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBwcmVsb2FkIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcHJlbG9hZCAtIFByZWxvYWQgZGF0YSBpbiBzaG9ydGhhbmQgb3IgbmVzdGVkIGZvcm0uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAtIE5vcm1hbGl6ZWQgcHJlbG9hZCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVByZWxvYWRSZWNvcmQocHJlbG9hZCkge1xuICBpZiAoIXByZWxvYWQpIHJldHVybiB7fVxuXG4gIGlmICh0eXBlb2YgcHJlbG9hZCA9PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHtbcHJlbG9hZF06IHRydWV9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShwcmVsb2FkKSkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByZWxvYWQpIHtcbiAgICAgIGlmICh0eXBlb2YgZW50cnkgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXN1bHRbZW50cnldID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChlbnRyeSkpIHtcbiAgICAgICAgaW5jb3Jwb3JhdGUocmVzdWx0LCBub3JtYWxpemVQcmVsb2FkUmVjb3JkKGVudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgZW50cnkgdHlwZTogJHt0eXBlb2YgZW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3QocHJlbG9hZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCB0eXBlOiAke3R5cGVvZiBwcmVsb2FkfWApXG4gIH1cblxuICAvKipcbiAgICogUmVzdWx0LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICBjb25zdCByZXN1bHQgPSB7fVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWQpKSB7XG4gICAgaWYgKHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgcmVzdWx0W2tleV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkgfHwgaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIHJlc3VsdFtrZXldID0gbm9ybWFsaXplUHJlbG9hZFJlY29yZCh2YWx1ZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdmFsdWUgZm9yICR7a2V5fTogJHt0eXBlb2YgdmFsdWV9YClcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICovXG5cbi8qKlxuICogQSBnZW5lcmljIHF1ZXJ5IG92ZXIgc29tZSBtb2RlbCB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtNQz10eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnkgZXh0ZW5kcyBEYXRhYmFzZVF1ZXJ5IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7TW9kZWxDbGFzc1F1ZXJ5QXJnc1R5cGU8TUM+fSBhcmdzIC0gUXVlcnkgY29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIGNvbnN0IHttb2RlbENsYXNzfSA9IGFyZ3NcblxuICAgIGlmICghbW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBObyBtb2RlbENsYXNzIGdpdmVuIGluICR7T2JqZWN0LmtleXMoYXJncykuam9pbihcIiwgXCIpfWApXG5cbiAgICBzdXBlcihhcmdzKVxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNQ30gKi9cbiAgICB0aGlzLm1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIHRoaXMuX2pvaW5CYXNlUGF0aCA9IGFyZ3Muam9pbkJhc2VQYXRoIHx8IFtdXG4gICAgdGhpcy5fam9pblRyYWNrZXIgPSBhcmdzLmpvaW5UcmFja2VyIHx8IG5ldyBKb2luVHJhY2tlcih7bW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzfSlcbiAgICB0aGlzLl9mb3JjZVF1YWxpZnlCYXNlVGFibGUgPSBCb29sZWFuKGFyZ3MuZm9yY2VRdWFsaWZ5QmFzZVRhYmxlKVxuICAgIHRoaXMuX29wZXJhdGlvbiA9IGFyZ3Mub3BlcmF0aW9uXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vd2l0aC1jb3VudC5qc1wiKS5XaXRoQ291bnRFbnRyeVtdfSAqL1xuICAgIHRoaXMuX3dpdGhDb3VudCA9IGFyZ3Mud2l0aENvdW50ID8gWy4uLmFyZ3Mud2l0aENvdW50XSA6IFtdXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFFbnRyeVtdfSAqL1xuICAgIHRoaXMuX3F1ZXJ5RGF0YSA9IGFyZ3MucXVlcnlEYXRhID8gWy4uLmFyZ3MucXVlcnlEYXRhXSA6IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9uZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIGNsb25lLlxuICAgKi9cbiAgY2xvbmUoKSB7XG4gICAgY29uc3QgbmV3UXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAobmV3IFZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnkoe1xuICAgICAgZHJpdmVyOiB0aGlzLl9kcml2ZXJGbixcbiAgICAgIGZyb21zOiBbLi4udGhpcy5fZnJvbXNdLFxuICAgICAgaGFuZGxlcjogdGhpcy5oYW5kbGVyLmNsb25lKCksXG4gICAgICBncm91cHM6IFsuLi50aGlzLl9ncm91cHNdLFxuICAgICAgam9pbnM6IFsuLi50aGlzLl9qb2luc10sXG4gICAgICBsaW1pdDogdGhpcy5fbGltaXQsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICBvZmZzZXQ6IHRoaXMuX29mZnNldCxcbiAgICAgIG9yZGVyczogWy4uLnRoaXMuX29yZGVyc10sXG4gICAgICBwYWdlOiB0aGlzLl9wYWdlLFxuICAgICAgcGVyUGFnZTogdGhpcy5fcGVyUGFnZSxcbiAgICAgIHByZWxvYWQ6IHsuLi50aGlzLl9wcmVsb2FkfSxcbiAgICAgIHByZWxvYWRTZWxlY3RzOiBjbG9uZVByZWxvYWRTZWxlY3RNYXAodGhpcy5fcHJlbG9hZFNlbGVjdHMpLFxuICAgICAgcHJlbG9hZFNlbGVjdHNFeHRyYTogY2xvbmVQcmVsb2FkU2VsZWN0TWFwKHRoaXMuX3ByZWxvYWRTZWxlY3RzRXh0cmEpLFxuICAgICAgZGlzdGluY3Q6IHRoaXMuX2Rpc3RpbmN0LFxuICAgICAgc2VsZWN0czogWy4uLnRoaXMuX3NlbGVjdHNdLFxuICAgICAgc2lnbmFsOiB0aGlzLl9zaWduYWwsXG4gICAgICB3aGVyZXM6IFsuLi50aGlzLl93aGVyZXNdLFxuICAgICAgam9pbkJhc2VQYXRoOiBbLi4udGhpcy5fam9pbkJhc2VQYXRoXSxcbiAgICAgIGpvaW5UcmFja2VyOiB0aGlzLl9qb2luVHJhY2tlci5jbG9uZSgpLFxuICAgICAgZm9yY2VRdWFsaWZ5QmFzZVRhYmxlOiB0aGlzLl9mb3JjZVF1YWxpZnlCYXNlVGFibGUsXG4gICAgICB3aXRoQ291bnQ6IFsuLi50aGlzLl93aXRoQ291bnRdLFxuICAgICAgcXVlcnlEYXRhOiBbLi4udGhpcy5fcXVlcnlEYXRhXSxcbiAgICAgIG9wZXJhdGlvbjogdGhpcy5fb3BlcmF0aW9uXG4gICAgfSkpXG5cbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgcmV0dXJuIG5ld1F1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogVGVsbCB0aGUgcXVlcnkgdG8gYXR0YWNoIG9uZSBvciBtb3JlIGFzc29jaWF0aW9uIGNvdW50cyBvbnRvIGV2ZXJ5XG4gICAqIGxvYWRlZCByZWNvcmQuIFRoZSBjb3VudHMgbGFuZCBhcyByZWd1bGFyIGF0dHJpYnV0ZXMgb24gZWFjaCByZWNvcmQ7XG4gICAqIHJlYWQgdGhlbSB3aXRoIGBtb2RlbC5yZWFkQXR0cmlidXRlKFwiPG5hbWU+Q291bnRcIilgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd2l0aC1jb3VudC5qc1wiKS5XaXRoQ291bnRTcGVjfSBzcGVjIC0gQ291bnQgc3BlYyBpbiBzaG9ydGhhbmQgb3IgbmVzdGVkIGZvcm0uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnksIGZvciBjaGFpbmluZy5cbiAgICovXG4gIHdpdGhDb3VudChzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVXaXRoQ291bnQoc3BlYykpIHtcbiAgICAgIHRoaXMuX3dpdGhDb3VudC5wdXNoKGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIG9uZSBvciBtb3JlIGNvbnN1bWVyLWRlZmluZWQsIHBlci1yb3cgY29tcHV0ZWQgdmFsdWVzIG9udG9cbiAgICogZXZlcnkgbG9hZGVkIHJvb3QgcmVjb3JkLiBMZWFmIHN0cmluZ3MgaW4gdGhlIHNwZWMgYXJlIG5hbWVzIG9mXG4gICAqIGZ1bmN0aW9ucyBwcmV2aW91c2x5IHJlZ2lzdGVyZWQgdmlhIGBNb2RlbC5xdWVyeURhdGEobmFtZSwgZm4pYC5cbiAgICogTmVzdGVkIG9iamVjdCBrZXlzIGFyZSByZWxhdGlvbnNoaXAgbmFtZXMgdHJhY2VkIGZyb20gdGhlIHJvb3QgdG9cbiAgICogdGhlIG1vZGVsIHRoYXQgZGVjbGFyZXMgdGhlIGZuLiBFdmVyeSByZXN1bHRpbmcgU0VMRUNUIGFsaWFzIGlzXG4gICAqIGF0dGFjaGVkIHRvIHRoZSAqKnJvb3QqKiByZWNvcmQgKG5vdCB0byB0aGUgaW50ZXJtZWRpYXRlIGpvaW5lZFxuICAgKiByb3dzKTsgcmVhZCB2YWx1ZXMgd2l0aCBgcmVjb3JkLnF1ZXJ5RGF0YShhbGlhc05hbWUpYC5cbiAgICpcbiAgICogU2VlIGFsc28gYHNyYy9kYXRhYmFzZS9xdWVyeS9xdWVyeS1kYXRhLmpzYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhU3BlY30gc3BlYyAtIFNwZWMgaW4gc2hvcnRoYW5kIG9yIG5lc3RlZCBmb3JtLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5LCBmb3IgY2hhaW5pbmcuXG4gICAqL1xuICBxdWVyeURhdGEoc3BlYykge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygbm9ybWFsaXplUXVlcnlEYXRhU3BlYyhzcGVjKSkge1xuICAgICAgdGhpcy5fcXVlcnlEYXRhLnB1c2goZW50cnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIHRhYmxlIHJlZmVyZW5jZSAoYWxpYXMgb3IgdGFibGUgbmFtZSkgcmVnaXN0ZXJlZCBmb3IgdGhlXG4gICAqIGdpdmVuIHJlbGF0aW9uc2hpcCBjaGFpbiwgcmVsYXRpdmUgdG8gdGhlIHF1ZXJ5J3MgY3VycmVudCBqb2luIGJhc2VcbiAgICogcGF0aC4gQ29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgYGdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbmAgZm9yIHVzZVxuICAgKiBpbnNpZGUgYHF1ZXJ5RGF0YWAgY2FsbGJhY2tzIHdoZXJlIHRoZSB3cml0ZXIncyBpbnRlbnQgcmVhZHMgbW9yZVxuICAgKiBuYXR1cmFsbHkgYXMgXCJnaXZlIG1lIHRoZSB0YWJsZSBuYW1lIGZvciAndGFza3MnXCIuXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggc2VnbWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVW5xdW90ZWQgdGFibGUgcmVmZXJlbmNlLlxuICAgKi9cbiAgdGFibGVOYW1lRm9yKC4uLnBhdGgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvdW50LlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgLy8gQSBtb2RlbCB3aXRob3V0IGEgc2luZ2xlIHByaW1hcnkta2V5IGNvbHVtbiDigJQgc2V0UHJpbWFyeUtleShudWxsKSBvciBhIGNvbXBvc2l0ZVxuICAgIC8vIHNldFByaW1hcnlLZXkoWy4uLl0pIG9uIGxlZ2FjeSB0YWJsZXMg4oCUIGhhcyBubyBjb2x1bW4gQ09VTlQgY2FuIHJlZmVyZW5jZSAoYW4gYXJyYXkgcHJpbWFyeSBrZXlcbiAgICAvLyBjYW5ub3QgYmUgcXVvdGVkIGFzIGEgc2luZ2xlIENPVU5UKGNvbHVtbiksIGFuZCBwcmltYXJ5S2V5KCkgZmFsbHMgYmFjayB0byBcImlkXCIgZm9yIHRoZSBuby1wa1xuICAgIC8vIGNhc2UsIHNvIGhhc1ByaW1hcnlLZXkoKSBkZXRlY3RzIHRoYXQgb25lKS5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmhhc1ByaW1hcnlLZXkoKSAmJiAhQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuXG4gICAgLy8gUGFnaW5hdGlvbiwgb3IgYW4gdW5ncm91cGVkIHF1ZXJ5IG9uIGEgbW9kZWwgd2l0aCBubyBzaW5nbGUgcHJpbWFyeS1rZXkgY29sdW1uLCBjb3VudHMgdmlhIHRoZVxuICAgIC8vIHN1YnF1ZXJ5IGZvcm0uIEl0IHJlZmVyZW5jZXMgbm8gcHJpbWFyeS1rZXkgY29sdW1uIGFuZCBwcmVzZXJ2ZXMgRElTVElOQ1Qgb3ZlciBqb2lucyDigJQgd2hpY2ggYVxuICAgIC8vIGJhcmUgQ09VTlQoKikgd291bGQgbm90IChpdCB3b3VsZCBjb3VudCBqb2luZWQgZHVwbGljYXRlIHJvd3MgaW5zdGVhZCBvZiBkaXN0aW5jdCByb290IHJvd3MpLlxuICAgIC8vIEEgZ3JvdXBlZCBxdWVyeSBzdGF5cyBvbiB0aGUgcGVyLWdyb3VwIGZsb3cgYmVsb3csIGJlY2F1c2UgdGhlIHN1YnF1ZXJ5IGZvcm0gd291bGQgY291bnQgb25lXG4gICAgLy8gcm93IHBlciBncm91cCBpbnN0ZWFkIG9mIHN1bW1pbmcgZWFjaCBncm91cCdzIHJvdyBjb3VudC5cbiAgICBpZiAodGhpcy5fbGltaXQgIT09IG51bGwgfHwgdGhpcy5fb2Zmc2V0ICE9PSBudWxsIHx8ICghaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleSAmJiB0aGlzLl9ncm91cHMubGVuZ3RoID09IDApKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5wYWdpbmF0ZWRDb3VudCgpXG4gICAgfVxuXG4gICAgaWYgKCFoYXNTaW5nbGVDb2x1bW5QcmltYXJ5S2V5ICYmIHRoaXMuX2Rpc3RpbmN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbid0IGNvdW50IGEgZ3JvdXBlZCBkaXN0aW5jdCBxdWVyeSBvbiAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IGJlY2F1c2UgaXQgaGFzIG5vIHNpbmdsZSBwcmltYXJ5LWtleSBjb2x1bW4gdG8gY291bnQgZGlzdGluY3QgdmFsdWVzIG9mYClcbiAgICB9XG5cbiAgICBjb25zdCBkaXN0aW5jdFByZWZpeCA9IHRoaXMuX2Rpc3RpbmN0ID8gXCJESVNUSU5DVCBcIiA6IFwiXCJcbiAgICBjb25zdCBjb3VudEV4cHJlc3Npb24gPSBoYXNTaW5nbGVDb2x1bW5QcmltYXJ5S2V5XG4gICAgICA/IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKCkpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocHJpbWFyeUtleSkpfWBcbiAgICAgIDogXCIqXCJcbiAgICBsZXQgc3FsID0gYENPVU5UKCR7ZGlzdGluY3RQcmVmaXh9JHtjb3VudEV4cHJlc3Npb259KWBcblxuICAgIGlmICh0aGlzLmRyaXZlci5nZXRUeXBlKCkgPT0gXCJwZ3NxbFwiKSBzcWwgKz0gXCI6OmludFwiXG5cbiAgICBzcWwgKz0gXCIgQVMgY291bnRcIlxuXG4gICAgLy8gQ2xvbmUgcXVlcnkgYW5kIGV4ZWN1dGUgY291bnRcbiAgICBjb25zdCBjb3VudFF1ZXJ5ID0gdGhpcy5jbG9uZSgpXG5cbiAgICBjb3VudFF1ZXJ5Ll9kaXN0aW5jdCA9IGZhbHNlXG4gICAgY291bnRRdWVyeS5fc2VsZWN0cyA9IFtdXG4gICAgY291bnRRdWVyeS5zZWxlY3Qoc3FsKVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IC8qKiBAdHlwZSB7e2NvdW50OiBudW1iZXJ9W119ICovIChhd2FpdCBjb3VudFF1ZXJ5Ll9leGVjdXRlUXVlcnkoe1xuICAgICAgbG9nTmFtZTogY291bnRRdWVyeS5xdWVyeUxvZ05hbWUoXCJDb3VudFwiKVxuICAgIH0pKVxuXG4gICAgLy8gVGhlIHF1ZXJ5IGlzbid0IGdyb3VwZWQgYW5kIGEgc2luZ2xlIHJlc3VsdCBoYXMgYmVlbiBnaXZlblxuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PSAxKSB7XG4gICAgICByZXR1cm4gcmVzdWx0c1swXS5jb3VudFxuICAgIH1cblxuICAgIC8vIFRoZSBxdWVyeSBtYXkgYmUgZ3JvdXBlZCBhbmQgYSBsb3Qgb2YgZGlmZmVyZW50IGNvdW50cyBhIGdpdmVuXG4gICAgbGV0IGNvdW50UmVzdWx0ID0gMFxuXG4gICAgZm9yIChjb25zdCByZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgaWYgKCEoXCJjb3VudFwiIGluIHJlc3VsdCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBjb3VudCByZXN1bHRcIilcbiAgICAgIH1cblxuICAgICAgY291bnRSZXN1bHQgKz0gcmVzdWx0LmNvdW50XG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50UmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdpbmF0ZWQgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY291bnQgYWZ0ZXIgcGFnaW5hdGlvbiBpcyBhcHBsaWVkLlxuICAgKi9cbiAgYXN5bmMgcGFnaW5hdGVkQ291bnQoKSB7XG4gICAgY29uc3QgY291bnRRdWVyeSA9IHRoaXMuY2xvbmUoKVxuICAgIGNvbnN0IGNvdW50U3FsID0gdGhpcy5kcml2ZXIuZ2V0VHlwZSgpID09IFwicGdzcWxcIiA/IFwiQ09VTlQoKik6OmludFwiIDogXCJDT1VOVCgqKVwiXG4gICAgY29uc3Qgc3FsID0gW1xuICAgICAgYFNFTEVDVCAke2NvdW50U3FsfSBBUyAke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKFwiY291bnRcIil9YCxcbiAgICAgIGBGUk9NICgke2NvdW50UXVlcnkudG9TcWwoKX0pIEFTICR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZShcInBhZ2luYXRlZF9jb3VudF9yb3dzXCIpfWBcbiAgICBdLmpvaW4oXCIgXCIpXG4gICAgY29uc3QgcmVzdWx0cyA9IC8qKiBAdHlwZSB7e2NvdW50OiBudW1iZXJ9W119ICovIChhd2FpdCB0aGlzLmRyaXZlci5xdWVyeShcbiAgICAgIHNxbCxcbiAgICAgIHtsb2dOYW1lOiB0aGlzLnF1ZXJ5TG9nTmFtZShcIkNvdW50XCIpLCBzaWduYWw6IHRoaXMuX3NpZ25hbH1cbiAgICApKVxuXG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEgfHwgIShcImNvdW50XCIgaW4gcmVzdWx0c1swXSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgY291bnQgcmVzdWx0XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbMF0uY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLlNlbGVjdEFyZ3VtZW50VHlwZX0gc2VsZWN0IC0gU2VsZWN0LlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgc2VsZWN0LlxuICAgKi9cbiAgc2VsZWN0KHNlbGVjdCkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdCkpIHtcbiAgICAgIGZvciAoY29uc3Qgc2VsZWN0RW50cnkgb2Ygc2VsZWN0KSB7XG4gICAgICAgIHRoaXMuc2VsZWN0KHNlbGVjdEVudHJ5KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygc2VsZWN0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCB0cmltbWVkU2VsZWN0ID0gc2VsZWN0LnRyaW0oKVxuXG4gICAgICBpZiAoL15bYS16QS1aX11bYS16QS1aMC05X10qJC8udGVzdCh0cmltbWVkU2VsZWN0KSkge1xuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTWFwID0gbW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGF0dHJpYnV0ZU1hcFt0cmltbWVkU2VsZWN0XSB8fCB0cmltbWVkU2VsZWN0XG4gICAgICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gdGhpcy5yb290VGFibGVSZWZlcmVuY2UoKVxuICAgICAgICBjb25zdCBxdWFsaWZpZWRDb2x1bW4gPSBgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRhYmxlUmVmZXJlbmNlKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgICAgcmV0dXJuIHN1cGVyLnNlbGVjdChxdWFsaWZpZWRDb2x1bW4pXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT2JqZWN0IGZvcm0ga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUsIGUuZy4gYC5zZWxlY3Qoe0FjY291bnQ6IFtcImlkXCJdfSlgLlxuICAgIC8vIFRoZXNlIGxpbWl0IHRoZSBhdHRyaWJ1dGVzIGxvYWRlZCBmb3IgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcCB0YXJnZXRzXG4gICAgLy8gcmF0aGVyIHRoYW4gdGhlIHJvb3QgcXVlcnkncyBTRUxFQ1QgY2xhdXNlLlxuICAgIGlmIChpc1BsYWluT2JqZWN0KHNlbGVjdCkpIHtcbiAgICAgIHRoaXMuX21lcmdlUHJlbG9hZFNlbGVjdCh0aGlzLl9wcmVsb2FkU2VsZWN0cywgc2VsZWN0KVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIHJldHVybiBzdXBlci5zZWxlY3Qoc2VsZWN0KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBkZWZhdWx0IGNvbHVtbnMgcGx1cyB0aGUgZ2l2ZW4gZXh0cmEgc2VsZWN0cyBmb3IgcHJlbG9hZGVkXG4gICAqIHJlbGF0aW9uc2hpcCB0YXJnZXRzLCBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZSwgZS5nLlxuICAgKiBgLnNlbGVjdHNFeHRyYSh7QWNjb3VudDogW1wiKFNFTEVDVCBjb3VudCgqKSBGUk9NIHByb2plY3RzKSBBUyBwcm9qZWN0c19jb3VudFwiXX0pYC5cbiAgICogVW5saWtlIGBzZWxlY3Qoey4uLn0pYCwgd2hpY2ggbmFycm93cyB0byBvbmx5IHRoZSBsaXN0ZWQgY29sdW1ucywgdGhpcyBrZWVwc1xuICAgKiB0aGUgZGVmYXVsdCBgU0VMRUNUICpgIGNvbHVtbnMgYW5kIGFkZHMgdGhlIGV4dHJhcyBvbiB0b3AuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSBzZWxlY3QgLSBFeHRyYSBzZWxlY3RzIGtleWVkIGJ5IHRhcmdldCBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5LCBmb3IgY2hhaW5pbmcuXG4gICAqL1xuICBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgdGhpcy5fbWVyZ2VQcmVsb2FkU2VsZWN0KHRoaXMuX3ByZWxvYWRTZWxlY3RzRXh0cmEsIHNlbGVjdClcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogTWVyZ2VzIGFuIG9iamVjdC1mb3JtIHByZWxvYWQgc2VsZWN0IChrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZSkgaW50byB0aGVcbiAgICogZ2l2ZW4gdGFyZ2V0IG1hcCwgZGUtZHVwbGljYXRpbmcgYXR0cmlidXRlL2V4cHJlc3Npb24gZW50cmllcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHRhcmdldCAtIE1hcCB0byBtZXJnZSBpbnRvLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPn0gc2VsZWN0IC0gT2JqZWN0LWZvcm0gc2VsZWN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbWVyZ2VQcmVsb2FkU2VsZWN0KHRhcmdldCwgc2VsZWN0KSB7XG4gICAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhzZWxlY3QpKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykgPyBhdHRyaWJ1dGVzIDogW2F0dHJpYnV0ZXNdXG5cbiAgICAgIGlmICghdGFyZ2V0W21vZGVsTmFtZV0pIHRhcmdldFttb2RlbE5hbWVdID0gW11cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2Ygbm9ybWFsaXplZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKCF0YXJnZXRbbW9kZWxOYW1lXS5pbmNsdWRlcyhhdHRyaWJ1dGUpKSB0YXJnZXRbbW9kZWxOYW1lXS5wdXNoKGF0dHJpYnV0ZSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb290IHRhYmxlIHJlZmVyZW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSb290IHRhYmxlIHJlZmVyZW5jZSBmb3IgcXVlcnkgc2VsZWN0IHF1YWxpZmljYXRpb24uXG4gICAqL1xuICByb290VGFibGVSZWZlcmVuY2UoKSB7XG4gICAgY29uc3QgZnJvbXMgPSB0aGlzLmdldEZyb21zKClcbiAgICBjb25zdCBsYXN0RnJvbSA9IGZyb21zW2Zyb21zLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAobGFzdEZyb20gJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkudGFibGVOYW1lID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxhc3RGcm9tKS50YWJsZU5hbWVcbiAgICB9XG5cbiAgICBpZiAobGFzdEZyb20gJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsYXN0RnJvbSkucGxhaW4gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IHBhcnNlZFJlZmVyZW5jZSA9IHBhcnNlRnJvbVBsYWluVGFibGVSZWZlcmVuY2UoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxhc3RGcm9tKS5wbGFpbilcblxuICAgICAgaWYgKHBhcnNlZFJlZmVyZW5jZSkgcmV0dXJuIHBhcnNlZFJlZmVyZW5jZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtNQ30gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5tb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoXCJtb2RlbENsYXNzIG5vdCBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIHJlbGF0aW9uc2hpcCB0YXJnZXQgdG8gdGhpcyBxdWVyeSdzIHBoeXNpY2FsIGRhdGFiYXNlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQ2Fub25pY2FsIHJlbGF0aW9uc2hpcCB0YXJnZXQuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gUXVlcnktYm91bmQgcmVsYXRpb25zaGlwIHRhcmdldC5cbiAgICovXG4gIGJpbmRNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvaW4gYmFzZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGpvaW4gYmFzZSBwYXRoLlxuICAgKi9cbiAgZ2V0Sm9pbkJhc2VQYXRoKCkge1xuICAgIHJldHVybiB0aGlzLl9qb2luQmFzZVBhdGhcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2luIHRyYWNrZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2pvaW4tdHJhY2tlci5qc1wiKS5kZWZhdWx0fSAtIFRoZSBqb2luIHRyYWNrZXIuXG4gICAqL1xuICBnZXRKb2luVHJhY2tlcigpIHtcbiAgICByZXR1cm4gdGhpcy5fam9pblRyYWNrZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmb3JjZSBxdWFsaWZ5IGJhc2UgdGFibGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVhbGlmeSBiYXNlIHRhYmxlLlxuICAgKi9cbiAgZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLl9mb3JjZVF1YWxpZnlCYXNlVGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBqb2luIGJhc2UgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gam9pbkJhc2VQYXRoIC0gSm9pbiBiYXNlIHBhdGguXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBxdWVyeSB3aXRoIHVwZGF0ZWQgYmFzZSBwYXRoLlxuICAgKi9cbiAgc2V0Sm9pbkJhc2VQYXRoKGpvaW5CYXNlUGF0aCkge1xuICAgIHRoaXMuX2pvaW5CYXNlUGF0aCA9IGpvaW5CYXNlUGF0aFxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gam9pbkJhc2VQYXRoIC0gSm9pbiBiYXNlIHBhdGguXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgd2l0aEpvaW5QYXRoKGpvaW5CYXNlUGF0aCkge1xuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuY2xvbmUoKSlcblxuICAgIHNjb3BlZFF1ZXJ5Ll9qb2luQmFzZVBhdGggPSBqb2luQmFzZVBhdGhcbiAgICBzY29wZWRRdWVyeS5fam9pblRyYWNrZXIgPSB0aGlzLl9qb2luVHJhY2tlclxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHRhYmxlIG5hbWUgZm9yIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUYWJsZSBuYW1lIGZvciBwYXRoLlxuICAgKi9cbiAgX3Jlc29sdmVUYWJsZU5hbWVGb3JKb2luUGF0aChwYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc29sdmVNb2RlbENsYXNzRm9ySm9pblBhdGgocGF0aCkudGFibGVOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgbW9kZWwgY2xhc3MgZm9yIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBfcmVzb2x2ZU1vZGVsQ2xhc3NGb3JKb2luUGF0aChwYXRoKSB7XG4gICAgbGV0IG1vZGVsQ2xhc3MgPSB0aGlzLl9qb2luVHJhY2tlci5nZXRSb290TW9kZWxDbGFzcygpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcGF0aCkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBmb3IgJHttb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBtb2RlbENsYXNzID0gdGhpcy5iaW5kTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHt7dGFibGVOYW1lOiBzdHJpbmcsIGFsaWFzOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIFRoZSBlbnRyeS5cbiAgICovXG4gIF9yZWdpc3RlckpvaW5QYXRoKHBhdGgpIHtcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLl9yZXNvbHZlVGFibGVOYW1lRm9ySm9pblBhdGgocGF0aClcblxuICAgIHJldHVybiB0aGlzLl9qb2luVHJhY2tlci5yZWdpc3RlclBhdGgocGF0aCwgdGFibGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvaW4gdGFibGUgcmVmZXJlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVucXVvdGVkIHRhYmxlIHJlZmVyZW5jZSAoYWxpYXMgb3IgdGFibGUgbmFtZSkuXG4gICAqL1xuICBnZXRKb2luVGFibGVSZWZlcmVuY2UocGF0aCkge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fam9pblRyYWNrZXIuZ2V0RW50cnkocGF0aCkgfHwgdGhpcy5fcmVnaXN0ZXJKb2luUGF0aChwYXRoKVxuXG4gICAgcmV0dXJuIGVudHJ5LmFsaWFzIHx8IGVudHJ5LnRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIHJlZmVyZW5jZSBmb3Igam9pbi5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd9IHBhdGggLSBKb2luIHBhdGggc2VnbWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVW5xdW90ZWQgdGFibGUgcmVmZXJlbmNlIChhbGlhcyBvciB0YWJsZSBuYW1lKS5cbiAgICovXG4gIGdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wYXRoKSB7XG4gICAgY29uc3QgZnVsbFBhdGggPSB0aGlzLl9qb2luQmFzZVBhdGguY29uY2F0KHBhdGgpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRKb2luVGFibGVSZWZlcmVuY2UoZnVsbFBhdGgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgZm9yIGpvaW4uXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBwYXRoIC0gSm9pbiBwYXRoIHNlZ21lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1b3RlZCB0YWJsZSBuYW1lIGZvciBqb2luIHBhdGguXG4gICAqL1xuICBnZXRUYWJsZUZvckpvaW4oLi4ucGF0aCkge1xuICAgIHJldHVybiB0aGlzLmRyaXZlci5xdW90ZVRhYmxlKHRoaXMuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NvcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3IgfCBzdHJpbmcgfCBzdHJpbmdbXX0gcGF0aE9yU2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvciBvciBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IFttYXliZVNjb3BlRGVzY3JpcHRvcl0gLSBTY29wZSBkZXNjcmlwdG9yIHdoZW4gcGF0aCBpcyBnaXZlbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgc2NvcGUocGF0aE9yU2NvcGVEZXNjcmlwdG9yLCBtYXliZVNjb3BlRGVzY3JpcHRvcikge1xuICAgIGlmIChpc01vZGVsU2NvcGVEZXNjcmlwdG9yKHBhdGhPclNjb3BlRGVzY3JpcHRvcikgJiYgIW1heWJlU2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgICByZXR1cm4gdGhpcy5fYXBwbHlSb290U2NvcGUocGF0aE9yU2NvcGVEZXNjcmlwdG9yKVxuICAgIH1cblxuICAgIGlmICghbWF5YmVTY29wZURlc2NyaXB0b3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNjb3BlKHBhdGgsIGRlc2NyaXB0b3IpIHJlcXVpcmVzIGEgc2NvcGUgZGVzY3JpcHRvclwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hcHBseUpvaW5QYXRoU2NvcGUoe1xuICAgICAgam9pblBhdGg6IG5vcm1hbGl6ZVNjb3BlUGF0aCgvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdfSAqLyAocGF0aE9yU2NvcGVEZXNjcmlwdG9yKSksXG4gICAgICBzY29wZURlc2NyaXB0b3I6IG1heWJlU2NvcGVEZXNjcmlwdG9yXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHJvb3Qgc2NvcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IHNjb3BlRGVzY3JpcHRvciAtIFNjb3BlIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIF9hcHBseVJvb3RTY29wZShzY29wZURlc2NyaXB0b3IpIHtcbiAgICBpZiAoIWlzTW9kZWxTY29wZURlc2NyaXB0b3Ioc2NvcGVEZXNjcmlwdG9yKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2NvcGUoKSBleHBlY3RzIGEgZGVzY3JpcHRvciByZXR1cm5lZCBieSBkZWZpbmVTY29wZSguLi4pLnNjb3BlKC4uLilcIilcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZU1vZGVsQ2xhc3MgPSBiYWNrZW5kU2NvcGVNb2RlbENsYXNzKHNjb3BlRGVzY3JpcHRvcilcblxuICAgIGlmIChzY29wZU1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkgIT09IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhcHBseSAke3Njb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzLm5hbWV9IHNjb3BlIHRvICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gcXVlcnlgKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gLyoqIEB0eXBlIHt0aGlzIHwgdm9pZH0gKi8gKHNjb3BlRGVzY3JpcHRvci5jYWxsYmFjayh7XG4gICAgICBkcml2ZXI6IHRoaXMuZHJpdmVyLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCksXG4gICAgICBxdWVyeTogdGhpcyxcbiAgICAgIHRhYmxlOiB0aGlzLnJvb3RUYWJsZVJlZmVyZW5jZSgpXG4gICAgfSwgLi4uc2NvcGVEZXNjcmlwdG9yLnNjb3BlQXJncykpXG5cbiAgICByZXR1cm4gc2NvcGVkUXVlcnkgfHwgdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgam9pbiBwYXRoIHNjb3BlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW4tcGF0aCBzY29wZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmpvaW5QYXRoIC0gSm9pbiBwYXRoIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfSBhcmdzLnNjb3BlRGVzY3JpcHRvciAtIFNjb3BlIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIF9hcHBseUpvaW5QYXRoU2NvcGUoe2pvaW5QYXRoLCBzY29wZURlc2NyaXB0b3J9KSB7XG4gICAgaWYgKCFpc01vZGVsU2NvcGVEZXNjcmlwdG9yKHNjb3BlRGVzY3JpcHRvcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNjb3BlKCkgZXhwZWN0cyBhIGRlc2NyaXB0b3IgcmV0dXJuZWQgYnkgZGVmaW5lU2NvcGUoLi4uKS5zY29wZSguLi4pXCIpXG4gICAgfVxuXG4gICAgY29uc3QgZnVsbEpvaW5QYXRoID0gdGhpcy5nZXRKb2luQmFzZVBhdGgoKS5jb25jYXQoam9pblBhdGgpXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuX3Jlc29sdmVNb2RlbENsYXNzRm9ySm9pblBhdGgoZnVsbEpvaW5QYXRoKVxuXG4gICAgY29uc3Qgc2NvcGVNb2RlbENsYXNzID0gYmFja2VuZFNjb3BlTW9kZWxDbGFzcyhzY29wZURlc2NyaXB0b3IpXG5cbiAgICBpZiAoc2NvcGVNb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpICE9PSB0YXJnZXRNb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhcHBseSAke3Njb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzLm5hbWV9IHNjb3BlIHRvIGpvaW4gcGF0aCAke2Z1bGxKb2luUGF0aC5qb2luKFwiLlwiKX0gKCR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gdGhpcy5idWlsZEpvaW5TY29wZVF1ZXJ5KHRhcmdldE1vZGVsQ2xhc3MsIGZ1bGxKb2luUGF0aClcbiAgICBjb25zdCBvcmlnaW5hbEpvaW5Db3VudCA9IHNjb3BlZFF1ZXJ5Ll9qb2lucy5sZW5ndGhcbiAgICBjb25zdCBvcmlnaW5hbFdoZXJlQ291bnQgPSBzY29wZWRRdWVyeS5fd2hlcmVzLmxlbmd0aFxuICAgIGNvbnN0IGFwcGxpZWRRdWVyeSA9IC8qKiBAdHlwZSB7dHlwZW9mIHNjb3BlZFF1ZXJ5IHwgdm9pZH0gKi8gKHNjb3BlRGVzY3JpcHRvci5jYWxsYmFjayh7XG4gICAgICBkcml2ZXI6IHNjb3BlZFF1ZXJ5LmRyaXZlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBwYXRoOiBbLi4uZnVsbEpvaW5QYXRoXSxcbiAgICAgIHF1ZXJ5OiBzY29wZWRRdWVyeSxcbiAgICAgIHRhYmxlOiBzY29wZWRRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKVxuICAgIH0sIC4uLnNjb3BlRGVzY3JpcHRvci5zY29wZUFyZ3MpKSB8fCBzY29wZWRRdWVyeVxuXG4gICAgaWYgKGFwcGxpZWRRdWVyeS5nZXRGcm9tcygpLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuZ2V0RnJvbXMoKS5sZW5ndGggfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5nZXRHcm91cHMoKS5sZW5ndGggIT09IHNjb3BlZFF1ZXJ5LmdldEdyb3VwcygpLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5LmdldFNlbGVjdHMoKS5sZW5ndGggIT09IHNjb3BlZFF1ZXJ5LmdldFNlbGVjdHMoKS5sZW5ndGggfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fb3JkZXJzLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuX29yZGVycy5sZW5ndGggfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fbGltaXQgIT09IHNjb3BlZFF1ZXJ5Ll9saW1pdCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9vZmZzZXQgIT09IHNjb3BlZFF1ZXJ5Ll9vZmZzZXQgfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fcGFnZSAhPT0gc2NvcGVkUXVlcnkuX3BhZ2UgfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fcGVyUGFnZSAhPT0gc2NvcGVkUXVlcnkuX3BlclBhZ2UgfHxcbiAgICAgIGFwcGxpZWRRdWVyeS5fZGlzdGluY3QgIT09IHNjb3BlZFF1ZXJ5Ll9kaXN0aW5jdCB8fFxuICAgICAgT2JqZWN0LmtleXMoYXBwbGllZFF1ZXJ5Ll9wcmVsb2FkKS5sZW5ndGggIT09IE9iamVjdC5rZXlzKHNjb3BlZFF1ZXJ5Ll9wcmVsb2FkKS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkpvaW5lZC1wYXRoIHNjb3BlcyBtYXkgb25seSBhZGQgd2hlcmUoLi4uKSBhbmQgam9pbnMoLi4uKSBjbGF1c2VzXCIpXG4gICAgfVxuXG4gICAgaWYgKGFwcGxpZWRRdWVyeS5fam9pbnMubGVuZ3RoID4gb3JpZ2luYWxKb2luQ291bnQpIHtcbiAgICAgIGZvciAoY29uc3Qgam9pbiBvZiBhcHBsaWVkUXVlcnkuX2pvaW5zLnNsaWNlKG9yaWdpbmFsSm9pbkNvdW50KSkge1xuICAgICAgICBpZiAoam9pbiBpbnN0YW5jZW9mIEpvaW5PYmplY3QpIHtcbiAgICAgICAgICB0aGlzLl9qb2lucy5wdXNoKG5ldyBKb2luT2JqZWN0KGpvaW4ub2JqZWN0LCBmdWxsSm9pblBhdGgpKVxuICAgICAgICB9IGVsc2UgaWYgKGpvaW4gaW5zdGFuY2VvZiBKb2luUGxhaW4pIHtcbiAgICAgICAgICB0aGlzLl9qb2lucy5wdXNoKGpvaW4pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fam9pbnMucHVzaChqb2luKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFwcGxpZWRRdWVyeS5fd2hlcmVzLmxlbmd0aCA+IG9yaWdpbmFsV2hlcmVDb3VudCkge1xuICAgICAgdGhpcy5fd2hlcmVzLnB1c2goLi4uYXBwbGllZFF1ZXJ5Ll93aGVyZXMuc2xpY2Uob3JpZ2luYWxXaGVyZUNvdW50KSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgam9pbiBzY29wZSBxdWVyeS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGpvaW5QYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHNjb3BlZCBqb2luIHF1ZXJ5LlxuICAgKi9cbiAgYnVpbGRKb2luU2NvcGVRdWVyeSh0YXJnZXRNb2RlbENsYXNzLCBqb2luUGF0aCkge1xuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKFxuICAgICAgdGhpcy5fb3BlcmF0aW9uXG4gICAgICAgID8gdGhpcy5fb3BlcmF0aW9uLmZvck1vZGVsKHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICAgIDogdGFyZ2V0TW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICAgIClcblxuICAgIHNjb3BlZFF1ZXJ5Ll9qb2luVHJhY2tlciA9IHRoaXMuX2pvaW5UcmFja2VyXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5CYXNlUGF0aCA9IGpvaW5QYXRoXG4gICAgc2NvcGVkUXVlcnkuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZSA9IHRydWVcblxuICAgIHJldHVybiBzY29wZWRRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveSBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95QWxsKCkge1xuICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCB0aGlzLnRvQXJyYXkoKVxuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgYXdhaXQgcmVjb3JkLmRlc3Ryb3koKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIGJ1bGsgVVBEQVRFIG9uIGFsbCByb3dzIG1hdGNoaW5nIHRoZSBxdWVyeSdzIFdIRVJFXG4gICAqIGNsYXVzZS4gQnlwYXNzZXMgbW9kZWwgbGlmZWN5Y2xlIGNhbGxiYWNrcyDigJQgdXNlIHRoaXMgZm9yXG4gICAqIGVmZmljaWVudCBiYXRjaCB1cGRhdGVzIHdoZXJlIHBlci1yb3cgaG9va3MgYXJlbid0IG5lZWRlZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBjYW1lbENhc2UgYXR0cmlidXRlIG5hbWVzIOKGkiB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHVwZGF0ZSBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB1cGRhdGVBbGwoZGF0YSkge1xuICAgIGNvbnN0IGRyaXZlciA9IHRoaXMuZHJpdmVyXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKClcbiAgICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXMoZGF0YSlcblxuICAgIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBzZXRDb2xzID0gZW50cmllcy5tYXAoKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShrZXkpXG4gICAgICBjb25zdCBxdW90ZWQgPSB2YWx1ZSA9PT0gbnVsbCA/IFwiTlVMTFwiIDogZHJpdmVyLnF1b3RlKHZhbHVlKVxuXG4gICAgICByZXR1cm4gYCR7ZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfSA9ICR7cXVvdGVkfWBcbiAgICB9KS5qb2luKFwiLCBcIilcblxuICAgIGNvbnN0IGpvaW5zU3FsID0gbmV3IEpvaW5zUGFyc2VyKHtwcmV0dHk6IGZhbHNlLCBxdWVyeTogdGhpc30pLnRvU3FsKClcbiAgICBjb25zdCB3aGVyZVNxbCA9IG5ldyBXaGVyZVBhcnNlcih7cHJldHR5OiBmYWxzZSwgcXVlcnk6IHRoaXN9KS50b1NxbCgpXG4gICAgbGV0IHNxbFxuXG4gICAgaWYgKGpvaW5zU3FsLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIFVzZSBhIHN1YnF1ZXJ5IGZvciBjcm9zcy1kcml2ZXIgY29tcGF0aWJpbGl0eSAoU1FMaXRlXG4gICAgICAvLyBkb2Vzbid0IHN1cHBvcnQgVVBEQVRFIC4uLiBKT0lOKS5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkodGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfS51cGRhdGVBbGwoKSB3aXRoIGpvaW5zYClcbiAgICAgIGNvbnN0IHBrID0gZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpXG4gICAgICBjb25zdCBxdCA9IGRyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcblxuICAgICAgc3FsID0gYFVQREFURSAke3F0fSBTRVQgJHtzZXRDb2xzfSBXSEVSRSAke3BrfSBJTiAoU0VMRUNUICR7cXR9LiR7cGt9IEZST00gJHtxdH0ke2pvaW5zU3FsfSR7d2hlcmVTcWx9KWBcbiAgICB9IGVsc2Uge1xuICAgICAgc3FsID0gYFVQREFURSAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9IFNFVCAke3NldENvbHN9JHt3aGVyZVNxbH1gXG4gICAgfVxuXG4gICAgYXdhaXQgZHJpdmVyLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IHRoaXMucXVlcnlMb2dOYW1lKFwiVXBkYXRlIEFsbFwiKSwgc2lnbmFsOiB0aGlzLl9zaWduYWx9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gcmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpbmQuXG4gICAqL1xuICBhc3luYyBmaW5kKHJlY29yZElkKSB7XG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IG51bWJlciB8IHN0cmluZ319ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBPYmplY3QuYXNzaWduKGNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCByZWNvcmRJZCkpXG5cbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLmNsb25lKCkpXG5cbiAgICBuZXdRdWVyeS53aGVyZShjb25kaXRpb25zKVxuXG4gICAgY29uc3QgcmVjb3JkID0gKGF3YWl0IG5ld1F1ZXJ5LmZpcnN0KCkpXG5cbiAgICBpZiAoIXJlY29yZCkge1xuICAgICAgdGhyb3cgbmV3IFJlY29yZE5vdEZvdW5kRXJyb3IoYENvdWxkbid0IGZpbmQgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSB3aXRoICcke3RoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKX0nPSR7SlNPTi5zdHJpbmdpZnkocmVjb3JkSWQpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLmNsb25lKCkpXG5cbiAgICBuZXdRdWVyeS53aGVyZShjb25kaXRpb25zKVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ld1F1ZXJ5LmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgY3JlYXRlIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCB0aGlzLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcblxuICAgIGlmIChyZWNvcmQuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgIH1cblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkgb3IgZmFpbC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgbm90IGZvdW5kXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KGFyZzogSW5zdGFuY2VUeXBlPE1DPikgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBpbml0aWFsaXplIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmIChyZWNvcmQpIHJldHVybiByZWNvcmRcblxuICAgIGNvbnN0IG5ld1JlY29yZCA9IHRoaXMuYnVpbGQoY29uZGl0aW9ucylcblxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2sobmV3UmVjb3JkKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByZWNvcmQgb3duZWQgYnkgdGhlIHF1ZXJ5J3Mgb3BlcmF0aW9uLCB3aGVuIHByZXNlbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8TUM+fSAtIEJ1aWx0IHJlY29yZC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPE1DPn0gKi8gKG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpKVxuXG4gICAgaWYgKHRoaXMuX29wZXJhdGlvbikgdGhpcy5fb3BlcmF0aW9uLmJpbmRSZWNvcmQocmVjb3JkKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSByZWNvcmQgb3duZWQgYnkgdGhlIHF1ZXJ5J3Mgb3BlcmF0aW9uLCB3aGVuIHByZXNlbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIENyZWF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMgPSB7fSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuYnVpbGQoYXR0cmlidXRlcylcblxuICAgIGF3YWl0IHJlY29yZC5zYXZlKClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlyc3QuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IHRoaXMuY2xvbmUoKS5saW1pdCgxKS5yZW9yZGVyKHRoaXMuX2RlZmF1bHRJZGVudGl0eU9yZGVyKFwiQVNDXCIpKVxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBuZXdRdWVyeS50b0FycmF5KClcblxuICAgIHJldHVybiByZXN1bHRzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgYXN5bmMgbGFzdCgpIHtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5jbG9uZSgpLnJlb3JkZXIodGhpcy5fZGVmYXVsdElkZW50aXR5T3JkZXIoXCJERVNDXCIpKS5saW1pdCgxKS50b0FycmF5KClcblxuICAgIHJldHVybiByZXN1bHRzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGRldGVybWluaXN0aWMgZGVmYXVsdCBvcmRlciBmb3IgdGhlIG1vZGVsIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge1wiQVNDXCIgfCBcIkRFU0NcIn0gZGlyZWN0aW9uIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIG9yZGVyIGV4cHJlc3Npb24uXG4gICAqL1xuICBfZGVmYXVsdElkZW50aXR5T3JkZXIoZGlyZWN0aW9uKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3Qgb3JkZXJhYmxlQ29sdW1ucyA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5IDogW01vZGVsQ2xhc3Mub3JkZXJhYmxlQ29sdW1uKCldXG5cbiAgICByZXR1cm4gb3JkZXJhYmxlQ29sdW1uc1xuICAgICAgLm1hcCgoY29sdW1uKSA9PiBgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKE1vZGVsQ2xhc3MudGFibGVOYW1lKCkpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbil9ICR7ZGlyZWN0aW9ufWApXG4gICAgICAuam9pbihcIiwgXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBwcmVsb2FkLlxuICAgKi9cbiAgcHJlbG9hZChkYXRhKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkUmVjb3JkKGRhdGEpXG4gICAgaW5jb3Jwb3JhdGUodGhpcy5fcHJlbG9hZCwgbm9ybWFsaXplZFByZWxvYWQpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBxdWVyeSByZXN1bHRzIGludG8gbW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxJbnN0YW5jZVR5cGU8TUM+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IG1vZGVscyA9IFtdXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBjb25zdCBtb2RlbCA9IHRoaXMuYnVpbGQoKVxuXG4gICAgICBtb2RlbC5sb2FkRXhpc3RpbmdSZWNvcmQocmVzdWx0KVxuICAgICAgbW9kZWxzLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyByZWNvcmQgc28gdGhhdFxuICAgIC8vIGF1dG8tcHJlbG9hZCBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICBtb2RlbC5fbG9hZENvaG9ydCA9IG1vZGVsc1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9wcmVsb2FkKS5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgUHJlbG9hZGVyKHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICBtb2RlbHMsXG4gICAgICAgIHByZWxvYWQ6IHRoaXMuX3ByZWxvYWQsXG4gICAgICAgIHByZWxvYWRTZWxlY3RzOiB0aGlzLl9wcmVsb2FkU2VsZWN0cyxcbiAgICAgICAgcHJlbG9hZFNlbGVjdHNFeHRyYTogdGhpcy5fcHJlbG9hZFNlbGVjdHNFeHRyYVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgcHJlbG9hZGVyLnJ1bigpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3dpdGhDb3VudC5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBydW5XaXRoQ291bnQoe1xuICAgICAgICBlbnRyaWVzOiB0aGlzLl93aXRoQ291bnQsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxzXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9xdWVyeURhdGEubGVuZ3RoID4gMCAmJiBtb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcnVuUXVlcnlEYXRhKHtcbiAgICAgICAgZW50cmllczogdGhpcy5fcXVlcnlEYXRhLFxuICAgICAgICByb290TW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICByb290TW9kZWxzOiBtb2RlbHNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIHF1ZXJ5IHJlc3VsdHMgdG8gYXJyYXkgb2YgbW9kZWwgaW5zdGFuY2VzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEluc3RhbmNlVHlwZTxNQz4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUGx1Y2tzIG9uZSBvciBtb3JlIGNvbHVtbnMgZGlyZWN0bHkgZnJvbSB0aGUgZGF0YWJhc2Ugd2l0aG91dCBpbnN0YW50aWF0aW5nIG1vZGVscy5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd8c3RyaW5nW119IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcGx1Y2suXG4gICAqL1xuICBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgY29uc3QgZmxhdENvbHVtbnMgPSBjb2x1bW5zLmZsYXQoKVxuXG4gICAgaWYgKGZsYXRDb2x1bW5zLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFibGVOYW1lID0gbW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBmbGF0Q29sdW1ucy5tYXAoKGNvbHVtbikgPT4gYXR0cmlidXRlTWFwW2NvbHVtbl0gfHwgY29sdW1uKVxuXG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgcXVlcnkuX3ByZWxvYWQgPSB7fVxuICAgIHF1ZXJ5Ll9zZWxlY3RzID0gW11cblxuICAgIGNvbHVtbk5hbWVzLmZvckVhY2goKGNvbHVtbk5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHNlbGVjdFNxbCA9IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgIHF1ZXJ5LnNlbGVjdChzZWxlY3RTcWwpXG4gICAgfSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5fZXhlY3V0ZVF1ZXJ5KHtsb2dOYW1lOiBxdWVyeS5xdWVyeUxvZ05hbWUoXCJQbHVja1wiKX0pXG5cbiAgICBpZiAoY29sdW1uTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBbY29sdW1uTmFtZV0gPSBjb2x1bW5OYW1lc1xuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVtjb2x1bW5OYW1lXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgcm93SGFzaCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICByZXR1cm4gY29sdW1uTmFtZXMubWFwKChjb2x1bW5OYW1lKSA9PiByb3dIYXNoW2NvbHVtbk5hbWVdKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmUod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZSh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVNb2RlbENsYXNzSGFzaCh7XG4gICAgICAgICAgaGFzaDogcmVzb2x2ZWRIYXNoLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLFxuICAgICAgICAgIHF1YWxpZnlCYXNlVGFibGUsXG4gICAgICAgICAgcXVlcnk6IHRoaXNcbiAgICAgICAgfSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhmYWxsYmFja0hhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3VwZXIud2hlcmUoZmFsbGJhY2tIYXNoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0eXBlIG9mIHdoZXJlOiAke3R5cGVvZiB3aGVyZX0gKCR7d2hlcmUuY29uc3RydWN0b3IubmFtZX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLiBTdXBwb3J0cyBgc2Aga2V5IGZvciBzb3J0aW5nIChlLmcuLCBge3M6IFwibmFtZSBhc2NcIn1gKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYW5kIHNvcnQgYXBwbGllZC5cbiAgICovXG4gIHJhbnNhY2socGFyYW1zKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSBwYXJhbXNcbiAgICBjb25zdCBncm91cCA9IG5vcm1hbGl6ZVJhbnNhY2tHcm91cCh0aGlzLmdldE1vZGVsQ2xhc3MoKSwgZmlsdGVyUGFyYW1zKVxuXG4gICAgYXBwbHlSYW5zYWNrR3JvdXAoe2dyb3VwLCBxdWVyeTogdGhpc30pXG5cbiAgICBpZiAodHlwZW9mIHMgPT09IFwic3RyaW5nXCIgJiYgcy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc29ydHMgPSBwYXJzZVJhbnNhY2tTb3J0KHRoaXMuZ2V0TW9kZWxDbGFzcygpLCBzKVxuXG4gICAgICBmb3IgKGNvbnN0IHNvcnREZWYgb2Ygc29ydHMpIHtcbiAgICAgICAgdGhpcy5vcmRlcih7Y29sdW1uOiBzb3J0RGVmLmF0dHJpYnV0ZSwgZGlyZWN0aW9uOiBzb3J0RGVmLmRpcmVjdGlvbn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlIG5vdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmVOb3Qod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZU5vdCh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVOb3QobmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgICAgICAgIGhhc2g6IHJlc29sdmVkSGFzaCxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKSxcbiAgICAgICAgICBxdWFsaWZ5QmFzZVRhYmxlLFxuICAgICAgICAgIHF1ZXJ5OiB0aGlzXG4gICAgICAgIH0pKSlcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGZhbGxiYWNrSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBzdXBlci53aGVyZU5vdChmYWxsYmFja0hhc2gpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHR5cGUgb2Ygd2hlcmU6ICR7dHlwZW9mIHdoZXJlfSAoJHt3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgbG9nIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBRdWVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVlcnkgbG9nIG5hbWUuXG4gICAqL1xuICBxdWVyeUxvZ05hbWUob3BlcmF0aW9uKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9ICR7b3BlcmF0aW9ufWBcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyB0aGlzIHF1ZXJ5IGFzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGN1cnJlbnRTeW5jQ2xpZW50KCkuc3luYyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoaXMgcXVlcnkncyBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY29wZSBpcyBkZWFjdGl2YXRlZC5cbiAgICovXG4gIGFzeW5jIHVuc3luYygpIHtcbiAgICBhd2FpdCBjdXJyZW50U3luY0NsaWVudCgpLnVuc3luYyh0aGlzKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSByYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tHcm91cH0gYXJncy5ncm91cCAtIE5vcm1hbGl6ZWQgUmFuc2FjayBncm91cC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5UmFuc2Fja0dyb3VwKHtncm91cCwgcXVlcnl9KSB7XG4gIGNvbnN0IHdoZXJlID0gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSlcblxuICBpZiAod2hlcmUpIHtcbiAgICBxdWVyeS5fd2hlcmVzLnB1c2god2hlcmUpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgZ3JvdXAgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBhcmdzLmdyb3VwIC0gTm9ybWFsaXplZCBSYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIENvbWJpbmVkIHdoZXJlIGNsYXVzZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSkge1xuICAvKipcbiAgICogV2hlcmVzLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgY29uc3Qgd2hlcmVzID0gW11cblxuICBmb3IgKGNvbnN0IGNvbmRpdGlvbiBvZiBncm91cC5jb25kaXRpb25zKSB7XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pXG5cbiAgICBpZiAod2hlcmUpIHdoZXJlcy5wdXNoKHdoZXJlKVxuICB9XG5cbiAgZm9yIChjb25zdCBncm91cGluZyBvZiBncm91cC5ncm91cGluZ3MpIHtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkUmFuc2Fja0dyb3VwV2hlcmUoe2dyb3VwOiBncm91cGluZywgcXVlcnl9KVxuXG4gICAgaWYgKHdoZXJlKSB3aGVyZXMucHVzaCh3aGVyZSlcbiAgfVxuXG4gIGlmICh3aGVyZXMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcbiAgaWYgKHdoZXJlcy5sZW5ndGggPT09IDEpIHJldHVybiB3aGVyZXNbMF1cblxuICByZXR1cm4gbmV3IFdoZXJlQ29tYmluYXRvcih7XG4gICAgY29tYmluYXRvcjogZ3JvdXAuY29tYmluYXRvcixcbiAgICBxdWVyeSxcbiAgICB3aGVyZXNcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgY29uZGl0aW9uIHdoZXJlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBDb25kaXRpb24gd2hlcmUgY2xhdXNlLlxuICovXG5mdW5jdGlvbiBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pIHtcbiAgLyoqXG4gICAqIFdoZXJlcy5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gIGNvbnN0IHdoZXJlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgY29uZGl0aW9uLmF0dHJpYnV0ZXMpIHtcbiAgICB3aGVyZXMucHVzaChidWlsZFJhbnNhY2tBdHRyaWJ1dGVXaGVyZSh7YXR0cmlidXRlLCBjb25kaXRpb24sIHF1ZXJ5fSkpXG4gIH1cblxuICBpZiAod2hlcmVzLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG4gIGlmICh3aGVyZXMubGVuZ3RoID09PSAxKSByZXR1cm4gd2hlcmVzWzBdXG5cbiAgcmV0dXJuIG5ldyBXaGVyZUNvbWJpbmF0b3Ioe1xuICAgIGNvbWJpbmF0b3I6IGNvbmRpdGlvbi5jb21iaW5hdG9yLFxuICAgIHF1ZXJ5LFxuICAgIHdoZXJlc1xuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0fSAtIEF0dHJpYnV0ZSB3aGVyZSBjbGF1c2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZVdoZXJlKHthdHRyaWJ1dGUsIGNvbmRpdGlvbiwgcXVlcnl9KSB7XG4gIGNvbnN0IGhhc2ggPSBidWlsZFJhbnNhY2tBdHRyaWJ1dGVIYXNoKHthdHRyaWJ1dGUsIGNvbmRpdGlvbn0pXG4gIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoLCBtb2RlbENsYXNzOiBxdWVyeS5nZXRNb2RlbENsYXNzKCl9KVxuXG4gIGlmIChPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwKSB7XG4gICAgcXVlcnkuam9pbnMoam9pbk9iamVjdClcbiAgfVxuXG4gIGNvbnN0IHdoZXJlID0gbmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgIGhhc2gsXG4gICAgbW9kZWxDbGFzczogcXVlcnkuZ2V0TW9kZWxDbGFzcygpLFxuICAgIHF1YWxpZnlCYXNlVGFibGU6IHRydWUsXG4gICAgcXVlcnlcbiAgfSlcblxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJub3RfZXFcIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9pblwiKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIiAmJiAhY29uZGl0aW9uLnZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIHJldHVybiB3aGVyZVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gYXJncy5jb25kaXRpb24gLSBOb3JtYWxpemVkIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZUhhc2goe2F0dHJpYnV0ZSwgY29uZGl0aW9ufSkge1xuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJlcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiaW5cIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9lcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibm90X2luXCIpIHtcbiAgICByZXR1cm4gYnVpbGROZXN0ZWRSYW5zYWNrSGFzaCh7YXR0cmlidXRlLCB2YWx1ZTogY29uZGl0aW9uLnZhbHVlfSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIikge1xuICAgIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tIYXNoKHthdHRyaWJ1dGUsIHZhbHVlOiBudWxsfSlcbiAgfVxuXG4gIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe1xuICAgIGF0dHJpYnV0ZSxcbiAgICBvcGVyYXRvcjogcmFuc2Fja1R1cGxlT3BlcmF0b3IoY29uZGl0aW9uLnByZWRpY2F0ZSksXG4gICAgdmFsdWU6IHJhbnNhY2tUdXBsZVZhbHVlKGNvbmRpdGlvbilcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIEZpbmFsIHZhbHVlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTmVzdGVkUmFuc2Fja0hhc2goe2F0dHJpYnV0ZSwgdmFsdWV9KSB7XG4gIC8qKlxuICAgKiBIYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgaGFzaCA9IHtbYXR0cmlidXRlLmF0dHJpYnV0ZU5hbWVdOiB2YWx1ZX1cblxuICBmb3IgKGxldCBpbmRleCA9IGF0dHJpYnV0ZS5wYXRoLmxlbmd0aCAtIDE7IGluZGV4ID49IDA7IGluZGV4IC09IDEpIHtcbiAgICBoYXNoID0ge1thdHRyaWJ1dGUucGF0aFtpbmRleF1dOiBoYXNofVxuICB9XG5cbiAgcmV0dXJuIGhhc2hcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIHR1cGxlIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IGFyZ3Mub3BlcmF0b3IgLSBUdXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBGaW5hbCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTmVzdGVkIHR1cGxlIGhhc2ggc3VpdGFibGUgZm9yIHF1ZXJ5LndoZXJlLlxuICovXG5mdW5jdGlvbiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe2F0dHJpYnV0ZSwgb3BlcmF0b3IsIHZhbHVlfSkge1xuICAvKipcbiAgICogSGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IGhhc2ggPSB7XG4gICAgW2F0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lXTogW1thdHRyaWJ1dGUuYXR0cmlidXRlTmFtZSwgb3BlcmF0b3IsIHZhbHVlXV1cbiAgfVxuXG4gIGZvciAobGV0IGluZGV4ID0gYXR0cmlidXRlLnBhdGgubGVuZ3RoIC0gMTsgaW5kZXggPj0gMDsgaW5kZXggLT0gMSkge1xuICAgIGhhc2ggPSB7W2F0dHJpYnV0ZS5wYXRoW2luZGV4XV06IGhhc2h9XG4gIH1cblxuICByZXR1cm4gaGFzaFxufVxuXG4vKipcbiAqIFJ1bnMgcmFuc2FjayB0dXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrUHJlZGljYXRlfSBwcmVkaWNhdGUgLSBSYW5zYWNrIHByZWRpY2F0ZS5cbiAqIEByZXR1cm5zIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IC0gUXVlcnkgdHVwbGUgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIHJhbnNhY2tUdXBsZU9wZXJhdG9yKHByZWRpY2F0ZSkge1xuICBpZiAocHJlZGljYXRlID09PSBcImd0XCIgfHwgcHJlZGljYXRlID09PSBcImd0ZXFcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRlcVwiKSB7XG4gICAgcmV0dXJuIHByZWRpY2F0ZVxuICB9XG5cbiAgcmV0dXJuIFwibGlrZVwiXG59XG5cbi8qKlxuICogUnVucyByYW5zYWNrIHR1cGxlIHZhbHVlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGNvbmRpdGlvbiAtIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFF1ZXJ5IHR1cGxlIHZhbHVlLlxuICovXG5mdW5jdGlvbiByYW5zYWNrVHVwbGVWYWx1ZShjb25kaXRpb24pIHtcbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiY29udFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX0lYFxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJzdGFydFwiKSByZXR1cm4gYCR7Y29uZGl0aW9uLnZhbHVlfSVgXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcImVuZFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX1gXG5cbiAgcmV0dXJuIGNvbmRpdGlvbi52YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByZWxhdGlvbnNoaXAuXG4gKi9cbmZ1bmN0aW9uIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShtb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lKSB7XG4gIHJldHVybiBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gQXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgcmVzb2x2ZWQgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICBjb25zdCBhdHRyaWJ1dGVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gIGlmIChhdHRyaWJ1dGVNYXBba2V5XSkgcmV0dXJuIGF0dHJpYnV0ZU1hcFtrZXldXG5cbiAgY29uc3QgY29sdW1uTWFwID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgY29uc3QgdW5kZXJzY29yZWQgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoa2V5KVxuXG4gIHJldHVybiBjb2x1bW5NYXBba2V5XSB8fCBjb2x1bW5NYXBbdW5kZXJzY29yZWRdIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJ1bnMgc3BsaXQgd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3tyZXNvbHZlZEhhc2g6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZmFsbGJhY2tIYXNoOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAtIFNwbGl0IGhhc2hlcy5cbiAqL1xuZnVuY3Rpb24gc3BsaXRXaGVyZUhhc2goe2hhc2gsIG1vZGVsQ2xhc3N9KSB7XG4gIC8qKlxuICAgKiBSZXNvbHZlZCBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCByZXNvbHZlZEhhc2ggPSB7fVxuICAvKipcbiAgICogRmFsbGJhY2sgaGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgZmFsbGJhY2tIYXNoID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCBpc05lc3RlZCA9IGlzUGxhaW5PYmplY3QodmFsdWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG1vZGVsQ2xhc3MsIGtleSlcblxuICAgIGlmIChpc05lc3RlZCkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcCkge1xuICAgICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc3VsdCA9IHNwbGl0V2hlcmVIYXNoKHtoYXNoOiB2YWx1ZSwgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc30pXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc29sdmVkS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5yZXNvbHZlZEhhc2gpXG4gICAgICAgIGNvbnN0IG5lc3RlZEZhbGxiYWNrS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5mYWxsYmFja0hhc2gpXG5cbiAgICAgICAgaWYgKG5lc3RlZFJlc29sdmVkS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmVzb2x2ZWRIYXNoW2tleV0gPSBuZXN0ZWRSZXN1bHQucmVzb2x2ZWRIYXNoXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkRmFsbGJhY2tLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0YXJnZXRNb2RlbENsYXNzLnRhYmxlTmFtZSgpXG5cbiAgICAgICAgICBpZiAoIWZhbGxiYWNrSGFzaFt0YWJsZU5hbWVdKSBmYWxsYmFja0hhc2hbdGFibGVOYW1lXSA9IHt9XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihmYWxsYmFja0hhc2hbdGFibGVOYW1lXSwgbmVzdGVkUmVzdWx0LmZhbGxiYWNrSGFzaClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2tIYXNoW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwICYmIGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICByZXNvbHZlZEhhc2hba2V5XSA9IG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSB7XG4gICAgICAgIHJlc29sdmVkSGFzaFtjb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGpvaW4gb2JqZWN0IGZyb20gd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBKb2luIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaCwgbW9kZWxDbGFzc30pIHtcbiAgLyoqXG4gICAqIEpvaW4gb2JqZWN0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBqb2luT2JqZWN0ID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBnZXRSZWxhdGlvbnNoaXBCeU5hbWUobW9kZWxDbGFzcywga2V5KVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIGNvbnRpbnVlXG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG4gICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCBuZXN0ZWRKb2luT2JqZWN0ID0gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaDogdmFsdWUsIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgICBqb2luT2JqZWN0W2tleV0gPSBPYmplY3Qua2V5cyhuZXN0ZWRKb2luT2JqZWN0KS5sZW5ndGggPiAwID8gbmVzdGVkSm9pbk9iamVjdCA6IHRydWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICBqb2luT2JqZWN0W2tleV0gPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGpvaW5PYmplY3Rcbn1cblxuY29uc3QgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibm90RXFcIiwgXCJndFwiLCBcImd0ZXFcIiwgXCJsdFwiLCBcImx0ZXFcIiwgXCJsaWtlXCIsIFwiPlwiLCBcIj49XCIsIFwiPFwiLCBcIjw9XCJdKVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRvciAtIFJhdyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcmV0dXJucyB7XCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwifSAtIE5vcm1hbGl6ZWQgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gKi8gKFxuICAgIG9wZXJhdG9yQWxpYXNlc1svKiogQHR5cGUge1wiPFwiIHwgXCI8PVwiIHwgXCI+XCIgfCBcIj49XCJ9ICovIChvcGVyYXRvcildIHx8IG9wZXJhdG9yXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHR1cGxlVmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgaXMgYSByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUuXG4gKi9cbmZ1bmN0aW9uIGlzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKHR1cGxlVmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHR1cGxlVmFsdWUpIHx8IHR1cGxlVmFsdWUubGVuZ3RoIDwgMykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIHR5cGVvZiB0dXBsZVZhbHVlWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgdHlwZW9mIHR1cGxlVmFsdWVbMV0gPT09IFwic3RyaW5nXCIgJiZcbiAgICByZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9ycy5oYXModHVwbGVWYWx1ZVsxXSlcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59IC0gTm9ybWFsaXplZCB0dXBsZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIHR5cGU6ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge0FycmF5PFtzdHJpbmcsIFwiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIiwgdW5rbm93bl0+fSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cbiAgICAvKipcbiAgICAgKiBBZGQgY29uZGl0aW9uLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvblZhbHVlIC0gQ2FuZGlkYXRlIG5lc3RlZCBjb25kaXRpb24uXG4gICAgICovXG4gICAgY29uc3QgYWRkQ29uZGl0aW9uID0gKGNvbmRpdGlvblZhbHVlKSA9PiB7XG4gICAgICBpZiAoaXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGUoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHR1cGxlID0gLyoqIEB0eXBlIHtbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwiLCB1bmtub3duLCAuLi5BcnJheTx1bmtub3duPl19ICovIChjb25kaXRpb25WYWx1ZSlcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcih0dXBsZVsxXSlcblxuICAgICAgICBub3JtYWxpemVkLnB1c2goW1xuICAgICAgICAgIHR1cGxlWzBdLFxuICAgICAgICAgIG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgICAgICB0dXBsZVsyXVxuICAgICAgICBdKVxuXG4gICAgICAgIGlmICh0dXBsZS5sZW5ndGggPiAzKSB7XG4gICAgICAgICAgZm9yIChsZXQgaW5kZXggPSAzOyBpbmRleCA8IHR1cGxlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICAgICAgYWRkQ29uZGl0aW9uKHR1cGxlW2luZGV4XSlcbiAgICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShjb25kaXRpb25WYWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlbGF0aW9uc2hpcCB3aGVyZSBjb25kaXRpb25zIG11c3QgYmUgdHVwbGVzXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25kaXRpb25WYWx1ZSkuZm9yRWFjaCgobmVzdGVkQ29uZGl0aW9uVmFsdWUpID0+IHtcbiAgICAgIGFkZENvbmRpdGlvbihuZXN0ZWRDb25kaXRpb25WYWx1ZSlcbiAgICB9KVxuICB9XG5cbiAgYWRkQ29uZGl0aW9uKHZhbHVlKVxuXG4gIGlmIChub3JtYWxpemVkLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIGNhbm5vdCBiZSBlbXB0eVwiKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIGhhcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVsYXRpb25zaGlwIHdoZXJlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBjYW4gYmUgbm9ybWFsaXplZCB0byByZWxhdGlvbnNoaXAgdHVwbGVzLlxuICovXG5mdW5jdGlvbiBoYXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSB7XG4gIHRyeSB7XG4gICAgbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh2YWx1ZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG4iXX0=