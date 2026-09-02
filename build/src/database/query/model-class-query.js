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
        const hasSingleColumnPrimaryKey = this.getModelClass().hasPrimaryKey() && !Array.isArray(this.getModelClass().primaryKey());
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
            ? `${this.driver.quoteTable(this.getModelClass().tableName())}.${this.driver.quoteColumn(this.getModelClass().primaryKey())}`
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
            const pk = driver.quoteColumn(this.getModelClass().primaryKey());
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
     * @param {number|string} recordId - Record id.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
     */
    async find(recordId) {
        /**
         * Conditions.
         * @type {{[key: string]: number | string}} */
        const conditions = {};
        conditions[this.getModelClass().primaryKey()] = recordId;
        const newQuery = /** @type {VelociousDatabaseQueryModelClassQuery<MC>} */ (this.clone());
        newQuery.where(conditions);
        const record = (await newQuery.first());
        if (!record) {
            throw new RecordNotFoundError(`Couldn't find ${this.getModelClass().name} with '${this.getModelClass().primaryKey()}'=${recordId}`);
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
        const primaryKey = this.getModelClass().primaryKey();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWwtY2xhc3MtcXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLGlCQUFpQixDQUFBO0FBQzdDLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLG9DQUFvQyxDQUFBO0FBQ3BFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sU0FBUyxNQUFNLGdCQUFnQixDQUFBO0FBQ3RDLE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxZQUFZLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUNwRSxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsWUFBWSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sWUFBWSxDQUFBO0FBQ3RDLE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8sU0FBUyxNQUFNLGlCQUFpQixDQUFBO0FBQ3ZDLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sbUJBQW1CLE1BQU0scUNBQXFDLENBQUE7QUFDckUsT0FBTyxFQUFDLHFCQUFxQixFQUFFLGdCQUFnQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDOUUsT0FBTyxFQUFDLHNCQUFzQixFQUFDLE1BQU0sNEJBQTRCLENBQUE7QUFDakUsT0FBTyxlQUFlLE1BQU0sdUJBQXVCLENBQUE7QUFDbkQsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLFFBQVEsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNyQyxPQUFPLFdBQVcsTUFBTSxpQ0FBaUMsQ0FBQTtB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Q1IsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFBO1FBQ2pFLENBQUM7UUFFRCxtREFBbUQsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLG9CQUFvQixFQUFFLEVBQUU7WUFDcEcsWUFBWSxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDcEMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDLENBQUE7SUFFRCxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7SUFFbkIsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtJQUN2RSxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGtDQUFrQyxDQUFDLEtBQUs7SUFDL0MsSUFBSSxDQUFDO1FBQ0gsd0NBQXdDLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFL0MsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2luY29ycG9yYXRlfSBmcm9tIFwiaW5jb3Jwb3JhdG9yXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCB7Y3VycmVudFN5bmNDbGllbnR9IGZyb20gXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVF1ZXJ5RGF0YVNwZWMsIHJ1blF1ZXJ5RGF0YX0gZnJvbSBcIi4vcXVlcnktZGF0YS5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVdpdGhDb3VudCwgcnVuV2l0aENvdW50fSBmcm9tIFwiLi93aXRoLWNvdW50LmpzXCJcbmltcG9ydCBEYXRhYmFzZVF1ZXJ5IGZyb20gXCIuL2luZGV4LmpzXCJcbmltcG9ydCBKb2luT2JqZWN0IGZyb20gXCIuL2pvaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBKb2luUGxhaW4gZnJvbSBcIi4vam9pbi1wbGFpbi5qc1wiXG5pbXBvcnQgSm9pblRyYWNrZXIgZnJvbSBcIi4vam9pbi10cmFja2VyLmpzXCJcbmltcG9ydCBSZWNvcmROb3RGb3VuZEVycm9yIGZyb20gXCIuLi9yZWNvcmQvcmVjb3JkLW5vdC1mb3VuZC1lcnJvci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZVJhbnNhY2tHcm91cCwgcGFyc2VSYW5zYWNrU29ydH0gZnJvbSBcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIlxuaW1wb3J0IHtpc01vZGVsU2NvcGVEZXNjcmlwdG9yfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IFdoZXJlQ29tYmluYXRvciBmcm9tIFwiLi93aGVyZS1jb21iaW5hdG9yLmpzXCJcbmltcG9ydCBXaGVyZU1vZGVsQ2xhc3NIYXNoIGZyb20gXCIuL3doZXJlLW1vZGVsLWNsYXNzLWhhc2guanNcIlxuaW1wb3J0IFdoZXJlTm90IGZyb20gXCIuL3doZXJlLW5vdC5qc1wiXG5pbXBvcnQgSm9pbnNQYXJzZXIgZnJvbSBcIi4uL3F1ZXJ5LXBhcnNlci9qb2lucy1wYXJzZXIuanNcIlxuaW1wb3J0IFdoZXJlUGFyc2VyIGZyb20gXCIuLi9xdWVyeS1wYXJzZXIvd2hlcmUtcGFyc2VyLmpzXCJcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbTUM9dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vaW5kZXguanNcIikuUXVlcnlBcmdzVHlwZSAmIHttb2RlbENsYXNzOiBNQywgam9pbkJhc2VQYXRoPzogc3RyaW5nW10sIGpvaW5UcmFja2VyPzogaW1wb3J0KFwiLi9qb2luLXRyYWNrZXIuanNcIikuZGVmYXVsdCwgZm9yY2VRdWFsaWZ5QmFzZVRhYmxlPzogYm9vbGVhbiwgd2l0aENvdW50PzogaW1wb3J0KFwiLi93aXRoLWNvdW50LmpzXCIpLldpdGhDb3VudEVudHJ5W10sIHF1ZXJ5RGF0YT86IGltcG9ydChcIi4vcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFFbnRyeVtdLCBvcGVyYXRpb24/OiBpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH19IE1vZGVsQ2xhc3NRdWVyeUFyZ3NUeXBlXG4gKi9cbi8qKlxuICogUnVucyB1bnF1b3RlIHNxbCBpZGVudGlmaWVyLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gUG90ZW50aWFsbHkgcXVvdGVkIFNRTCBpZGVudGlmaWVyLlxuICogQHJldHVybnMge3N0cmluZ30gLSBVbnF1b3RlZCBpZGVudGlmaWVyLlxuICovXG5mdW5jdGlvbiB1bnF1b3RlU3FsSWRlbnRpZmllcih2YWx1ZSkge1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG5cbiAgaWYgKHRyaW1tZWQubGVuZ3RoID49IDIgJiYgKCh0cmltbWVkLnN0YXJ0c1dpdGgoXCJgXCIpICYmIHRyaW1tZWQuZW5kc1dpdGgoXCJgXCIpKSB8fCAodHJpbW1lZC5zdGFydHNXaXRoKFwiXFxcIlwiKSAmJiB0cmltbWVkLmVuZHNXaXRoKFwiXFxcIlwiKSkpKSB7XG4gICAgcmV0dXJuIHRyaW1tZWQuc2xpY2UoMSwgLTEpXG4gIH1cblxuICBpZiAodHJpbW1lZC5sZW5ndGggPj0gMiAmJiB0cmltbWVkLnN0YXJ0c1dpdGgoXCJbXCIpICYmIHRyaW1tZWQuZW5kc1dpdGgoXCJdXCIpKSB7XG4gICAgcmV0dXJuIHRyaW1tZWQuc2xpY2UoMSwgLTEpXG4gIH1cblxuICByZXR1cm4gdHJpbW1lZFxufVxuXG4vKipcbiAqIFJ1bnMgcGFyc2UgZnJvbSBwbGFpbiB0YWJsZSByZWZlcmVuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gZnJvbVBsYWluIC0gRlJPTSBjbGF1c2Ugc291cmNlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUGFyc2VkIHRhYmxlIHJlZmVyZW5jZSBvciBudWxsIHdoZW4gdW5zdXBwb3J0ZWQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlRnJvbVBsYWluVGFibGVSZWZlcmVuY2UoZnJvbVBsYWluKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBmcm9tUGxhaW4udHJpbSgpXG5cbiAgaWYgKHRyaW1tZWQubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcblxuICBjb25zdCBhbGlhc01hdGNoID0gdHJpbW1lZC5tYXRjaCgvKD86XnxcXHMpKD86QVNcXHMrKT8oW2BcIl0/W2EtekEtWl9dW2EtekEtWjAtOV9dKltgXCJdP3xcXFtbYS16QS1aX11bYS16QS1aMC05X10qXFxdKVxccyokL2kpXG5cbiAgaWYgKCFhbGlhc01hdGNoIHx8ICFhbGlhc01hdGNoWzFdKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiB1bnF1b3RlU3FsSWRlbnRpZmllcihhbGlhc01hdGNoWzFdKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHNjb3BlIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdfSBwYXRoIC0gU2NvcGUgcGF0aCBpbnB1dC5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIHBhdGguXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNjb3BlUGF0aChwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCA9PT0gXCJzdHJpbmdcIikge1xuICAgIGlmIChwYXRoLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIlNjb3BlIHBhdGggc3RyaW5ncyBtdXN0IGJlIG5vbi1lbXB0eVwiKVxuXG4gICAgcmV0dXJuIFtwYXRoXVxuICB9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNjb3BlIHBhdGggdHlwZTogJHt0eXBlb2YgcGF0aH1gKVxuICB9XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBwYXRoKSB7XG4gICAgaWYgKHR5cGVvZiBlbnRyeSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTY29wZSBwYXRoIGVudHJpZXMgbXVzdCBiZSBub24tZW1wdHkgc3RyaW5nc1wiKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBbLi4ucGF0aF1cbn1cblxuLyoqXG4gKiBOYXJyb3dzIGEgc2hhcmVkIG1vZGVsLXNjb3BlIGRlc2NyaXB0b3IgdG8gdGhlIGJhY2tlbmQgbW9kZWwgY2xhc3MgcmVxdWlyZWQgYnkgTW9kZWxDbGFzc1F1ZXJ5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gc2NvcGVEZXNjcmlwdG9yIC0gU2hhcmVkIHNjb3BlIGRlc2NyaXB0b3IuXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEJhY2tlbmQgc2NvcGUgb3duZXIuXG4gKi9cbmZ1bmN0aW9uIGJhY2tlbmRTY29wZU1vZGVsQ2xhc3Moc2NvcGVEZXNjcmlwdG9yKSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSBzY29wZURlc2NyaXB0b3IubW9kZWxDbGFzc1xuXG4gIGlmICghKFwiY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzXCIgaW4gbW9kZWxDbGFzcykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJBIGZyb250ZW5kLW1vZGVsIHNjb3BlIGNhbm5vdCBiZSBhcHBsaWVkIHRvIGEgZGF0YWJhc2UgcmVjb3JkIHF1ZXJ5XCIpXG4gIH1cblxuICAvLyBUaGUgcnVudGltZSBtZW1iZXIgY2hlY2sgYWJvdmUgbmFycm93cyB0aGUgc2hhcmVkIGZyb250ZW5kL2JhY2tlbmQgZGVzY3JpcHRvciBib3VuZGFyeS5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBEZWVwLWNvcGllcyBhIHByZWxvYWQgc2VsZWN0IG1hcCAoa2V5ZWQgYnkgbW9kZWwgbmFtZSB3aXRoIGF0dHJpYnV0ZSBhcnJheXMpXG4gKiBzbyBhIGNsb25lZCBxdWVyeSdzIHNlbGVjdGlvbnMgY2FuIGJlIG11dGF0ZWQgd2l0aG91dCBhZmZlY3RpbmcgdGhlIG9yaWdpbmFsLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IG1hcCAtIFByZWxvYWQgc2VsZWN0IG1hcCB0byBjb3B5LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gLSBBIGNvcHkgd2l0aCBpbmRlcGVuZGVudCBhcnJheXMuXG4gKi9cbmZ1bmN0aW9uIGNsb25lUHJlbG9hZFNlbGVjdE1hcChtYXApIHtcbiAgLyoqXG4gICAqIFJlc3VsdC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgY29uc3QgcmVzdWx0ID0ge31cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGF0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKG1hcCkpIHtcbiAgICByZXN1bHRbbW9kZWxOYW1lXSA9IFsuLi5hdHRyaWJ1dGVzXVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHByZWxvYWQgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBkYXRhIGluIHNob3J0aGFuZCBvciBuZXN0ZWQgZm9ybS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IC0gTm9ybWFsaXplZCBwcmVsb2FkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUHJlbG9hZFJlY29yZChwcmVsb2FkKSB7XG4gIGlmICghcHJlbG9hZCkgcmV0dXJuIHt9XG5cbiAgaWYgKHR5cGVvZiBwcmVsb2FkID09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4ge1twcmVsb2FkXTogdHJ1ZX1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHByZWxvYWQpKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcHJlbG9hZCkge1xuICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJlc3VsdFtlbnRyeV0gPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KGVudHJ5KSkge1xuICAgICAgICBpbmNvcnBvcmF0ZShyZXN1bHQsIG5vcm1hbGl6ZVByZWxvYWRSZWNvcmQoZW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCBlbnRyeSB0eXBlOiAke3R5cGVvZiBlbnRyeX1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChwcmVsb2FkKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcmVsb2FkIHR5cGU6ICR7dHlwZW9mIHByZWxvYWR9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXN1bHQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovXG4gIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZCkpIHtcbiAgICBpZiAodmFsdWUgPT09IHRydWUgfHwgdmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICByZXN1bHRba2V5XSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSB8fCBpc1BsYWluT2JqZWN0KHZhbHVlKSkge1xuICAgICAgcmVzdWx0W2tleV0gPSBub3JtYWxpemVQcmVsb2FkUmVjb3JkKHZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCB2YWx1ZSBmb3IgJHtrZXl9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtNQz10eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKi9cblxuLyoqXG4gKiBBIGdlbmVyaWMgcXVlcnkgb3ZlciBzb21lIG1vZGVsIHR5cGUuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW01DPXR5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeSBleHRlbmRzIERhdGFiYXNlUXVlcnkge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtNb2RlbENsYXNzUXVlcnlBcmdzVHlwZTxNQz59IGFyZ3MgLSBRdWVyeSBjb25zdHJ1Y3RvciBhcmd1bWVudHMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzKSB7XG4gICAgY29uc3Qge21vZGVsQ2xhc3N9ID0gYXJnc1xuXG4gICAgaWYgKCFtb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYE5vIG1vZGVsQ2xhc3MgZ2l2ZW4gaW4gJHtPYmplY3Qua2V5cyhhcmdzKS5qb2luKFwiLCBcIil9YClcblxuICAgIHN1cGVyKGFyZ3MpXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01DfSAqL1xuICAgIHRoaXMubW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgdGhpcy5fam9pbkJhc2VQYXRoID0gYXJncy5qb2luQmFzZVBhdGggfHwgW11cbiAgICB0aGlzLl9qb2luVHJhY2tlciA9IGFyZ3Muam9pblRyYWNrZXIgfHwgbmV3IEpvaW5UcmFja2VyKHttb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3N9KVxuICAgIHRoaXMuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZSA9IEJvb2xlYW4oYXJncy5mb3JjZVF1YWxpZnlCYXNlVGFibGUpXG4gICAgdGhpcy5fb3BlcmF0aW9uID0gYXJncy5vcGVyYXRpb25cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi93aXRoLWNvdW50LmpzXCIpLldpdGhDb3VudEVudHJ5W119ICovXG4gICAgdGhpcy5fd2l0aENvdW50ID0gYXJncy53aXRoQ291bnQgPyBbLi4uYXJncy53aXRoQ291bnRdIDogW11cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUVudHJ5W119ICovXG4gICAgdGhpcy5fcXVlcnlEYXRhID0gYXJncy5xdWVyeURhdGEgPyBbLi4uYXJncy5xdWVyeURhdGFdIDogW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb25lLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGUgY2xvbmUuXG4gICAqL1xuICBjbG9uZSgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovIChuZXcgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeSh7XG4gICAgICBkcml2ZXI6IHRoaXMuX2RyaXZlckZuLFxuICAgICAgZnJvbXM6IFsuLi50aGlzLl9mcm9tc10sXG4gICAgICBoYW5kbGVyOiB0aGlzLmhhbmRsZXIuY2xvbmUoKSxcbiAgICAgIGdyb3VwczogWy4uLnRoaXMuX2dyb3Vwc10sXG4gICAgICBqb2luczogWy4uLnRoaXMuX2pvaW5zXSxcbiAgICAgIGxpbWl0OiB0aGlzLl9saW1pdCxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgIG9mZnNldDogdGhpcy5fb2Zmc2V0LFxuICAgICAgb3JkZXJzOiBbLi4udGhpcy5fb3JkZXJzXSxcbiAgICAgIHBhZ2U6IHRoaXMuX3BhZ2UsXG4gICAgICBwZXJQYWdlOiB0aGlzLl9wZXJQYWdlLFxuICAgICAgcHJlbG9hZDogey4uLnRoaXMuX3ByZWxvYWR9LFxuICAgICAgcHJlbG9hZFNlbGVjdHM6IGNsb25lUHJlbG9hZFNlbGVjdE1hcCh0aGlzLl9wcmVsb2FkU2VsZWN0cyksXG4gICAgICBwcmVsb2FkU2VsZWN0c0V4dHJhOiBjbG9uZVByZWxvYWRTZWxlY3RNYXAodGhpcy5fcHJlbG9hZFNlbGVjdHNFeHRyYSksXG4gICAgICBkaXN0aW5jdDogdGhpcy5fZGlzdGluY3QsXG4gICAgICBzZWxlY3RzOiBbLi4udGhpcy5fc2VsZWN0c10sXG4gICAgICBzaWduYWw6IHRoaXMuX3NpZ25hbCxcbiAgICAgIHdoZXJlczogWy4uLnRoaXMuX3doZXJlc10sXG4gICAgICBqb2luQmFzZVBhdGg6IFsuLi50aGlzLl9qb2luQmFzZVBhdGhdLFxuICAgICAgam9pblRyYWNrZXI6IHRoaXMuX2pvaW5UcmFja2VyLmNsb25lKCksXG4gICAgICBmb3JjZVF1YWxpZnlCYXNlVGFibGU6IHRoaXMuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZSxcbiAgICAgIHdpdGhDb3VudDogWy4uLnRoaXMuX3dpdGhDb3VudF0sXG4gICAgICBxdWVyeURhdGE6IFsuLi50aGlzLl9xdWVyeURhdGFdLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLl9vcGVyYXRpb25cbiAgICB9KSlcblxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICByZXR1cm4gbmV3UXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBxdWVyeSB0byBhdHRhY2ggb25lIG9yIG1vcmUgYXNzb2NpYXRpb24gY291bnRzIG9udG8gZXZlcnlcbiAgICogbG9hZGVkIHJlY29yZC4gVGhlIGNvdW50cyBsYW5kIGFzIHJlZ3VsYXIgYXR0cmlidXRlcyBvbiBlYWNoIHJlY29yZDtcbiAgICogcmVhZCB0aGVtIHdpdGggYG1vZGVsLnJlYWRBdHRyaWJ1dGUoXCI8bmFtZT5Db3VudFwiKWAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi93aXRoLWNvdW50LmpzXCIpLldpdGhDb3VudFNwZWN9IHNwZWMgLSBDb3VudCBzcGVjIGluIHNob3J0aGFuZCBvciBuZXN0ZWQgZm9ybS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSwgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgd2l0aENvdW50KHNwZWMpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZVdpdGhDb3VudChzcGVjKSkge1xuICAgICAgdGhpcy5fd2l0aENvdW50LnB1c2goZW50cnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggb25lIG9yIG1vcmUgY29uc3VtZXItZGVmaW5lZCwgcGVyLXJvdyBjb21wdXRlZCB2YWx1ZXMgb250b1xuICAgKiBldmVyeSBsb2FkZWQgcm9vdCByZWNvcmQuIExlYWYgc3RyaW5ncyBpbiB0aGUgc3BlYyBhcmUgbmFtZXMgb2ZcbiAgICogZnVuY3Rpb25zIHByZXZpb3VzbHkgcmVnaXN0ZXJlZCB2aWEgYE1vZGVsLnF1ZXJ5RGF0YShuYW1lLCBmbilgLlxuICAgKiBOZXN0ZWQgb2JqZWN0IGtleXMgYXJlIHJlbGF0aW9uc2hpcCBuYW1lcyB0cmFjZWQgZnJvbSB0aGUgcm9vdCB0b1xuICAgKiB0aGUgbW9kZWwgdGhhdCBkZWNsYXJlcyB0aGUgZm4uIEV2ZXJ5IHJlc3VsdGluZyBTRUxFQ1QgYWxpYXMgaXNcbiAgICogYXR0YWNoZWQgdG8gdGhlICoqcm9vdCoqIHJlY29yZCAobm90IHRvIHRoZSBpbnRlcm1lZGlhdGUgam9pbmVkXG4gICAqIHJvd3MpOyByZWFkIHZhbHVlcyB3aXRoIGByZWNvcmQucXVlcnlEYXRhKGFsaWFzTmFtZSlgLlxuICAgKlxuICAgKiBTZWUgYWxzbyBgc3JjL2RhdGFiYXNlL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFTcGVjfSBzcGVjIC0gU3BlYyBpbiBzaG9ydGhhbmQgb3IgbmVzdGVkIGZvcm0uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnksIGZvciBjaGFpbmluZy5cbiAgICovXG4gIHF1ZXJ5RGF0YShzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVRdWVyeURhdGFTcGVjKHNwZWMpKSB7XG4gICAgICB0aGlzLl9xdWVyeURhdGEucHVzaChlbnRyeSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiB0aGUgdGFibGUgcmVmZXJlbmNlIChhbGlhcyBvciB0YWJsZSBuYW1lKSByZWdpc3RlcmVkIGZvciB0aGVcbiAgICogZ2l2ZW4gcmVsYXRpb25zaGlwIGNoYWluLCByZWxhdGl2ZSB0byB0aGUgcXVlcnkncyBjdXJyZW50IGpvaW4gYmFzZVxuICAgKiBwYXRoLiBDb252ZW5pZW5jZSB3cmFwcGVyIGFyb3VuZCBgZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luYCBmb3IgdXNlXG4gICAqIGluc2lkZSBgcXVlcnlEYXRhYCBjYWxsYmFja3Mgd2hlcmUgdGhlIHdyaXRlcidzIGludGVudCByZWFkcyBtb3JlXG4gICAqIG5hdHVyYWxseSBhcyBcImdpdmUgbWUgdGhlIHRhYmxlIG5hbWUgZm9yICd0YXNrcydcIi5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd9IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBzZWdtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBVbnF1b3RlZCB0YWJsZSByZWZlcmVuY2UuXG4gICAqL1xuICB0YWJsZU5hbWVGb3IoLi4ucGF0aCkge1xuICAgIHJldHVybiB0aGlzLmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY291bnQuXG4gICAqL1xuICBhc3luYyBjb3VudCgpIHtcbiAgICAvLyBBIG1vZGVsIHdpdGhvdXQgYSBzaW5nbGUgcHJpbWFyeS1rZXkgY29sdW1uIOKAlCBzZXRQcmltYXJ5S2V5KG51bGwpIG9yIGEgY29tcG9zaXRlXG4gICAgLy8gc2V0UHJpbWFyeUtleShbLi4uXSkgb24gbGVnYWN5IHRhYmxlcyDigJQgaGFzIG5vIGNvbHVtbiBDT1VOVCBjYW4gcmVmZXJlbmNlIChhbiBhcnJheSBwcmltYXJ5IGtleVxuICAgIC8vIGNhbm5vdCBiZSBxdW90ZWQgYXMgYSBzaW5nbGUgQ09VTlQoY29sdW1uKSwgYW5kIHByaW1hcnlLZXkoKSBmYWxscyBiYWNrIHRvIFwiaWRcIiBmb3IgdGhlIG5vLXBrXG4gICAgLy8gY2FzZSwgc28gaGFzUHJpbWFyeUtleSgpIGRldGVjdHMgdGhhdCBvbmUpLlxuICAgIGNvbnN0IGhhc1NpbmdsZUNvbHVtblByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5oYXNQcmltYXJ5S2V5KCkgJiYgIUFycmF5LmlzQXJyYXkodGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpKVxuXG4gICAgLy8gUGFnaW5hdGlvbiwgb3IgYW4gdW5ncm91cGVkIHF1ZXJ5IG9uIGEgbW9kZWwgd2l0aCBubyBzaW5nbGUgcHJpbWFyeS1rZXkgY29sdW1uLCBjb3VudHMgdmlhIHRoZVxuICAgIC8vIHN1YnF1ZXJ5IGZvcm0uIEl0IHJlZmVyZW5jZXMgbm8gcHJpbWFyeS1rZXkgY29sdW1uIGFuZCBwcmVzZXJ2ZXMgRElTVElOQ1Qgb3ZlciBqb2lucyDigJQgd2hpY2ggYVxuICAgIC8vIGJhcmUgQ09VTlQoKikgd291bGQgbm90IChpdCB3b3VsZCBjb3VudCBqb2luZWQgZHVwbGljYXRlIHJvd3MgaW5zdGVhZCBvZiBkaXN0aW5jdCByb290IHJvd3MpLlxuICAgIC8vIEEgZ3JvdXBlZCBxdWVyeSBzdGF5cyBvbiB0aGUgcGVyLWdyb3VwIGZsb3cgYmVsb3csIGJlY2F1c2UgdGhlIHN1YnF1ZXJ5IGZvcm0gd291bGQgY291bnQgb25lXG4gICAgLy8gcm93IHBlciBncm91cCBpbnN0ZWFkIG9mIHN1bW1pbmcgZWFjaCBncm91cCdzIHJvdyBjb3VudC5cbiAgICBpZiAodGhpcy5fbGltaXQgIT09IG51bGwgfHwgdGhpcy5fb2Zmc2V0ICE9PSBudWxsIHx8ICghaGFzU2luZ2xlQ29sdW1uUHJpbWFyeUtleSAmJiB0aGlzLl9ncm91cHMubGVuZ3RoID09IDApKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5wYWdpbmF0ZWRDb3VudCgpXG4gICAgfVxuXG4gICAgaWYgKCFoYXNTaW5nbGVDb2x1bW5QcmltYXJ5S2V5ICYmIHRoaXMuX2Rpc3RpbmN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbid0IGNvdW50IGEgZ3JvdXBlZCBkaXN0aW5jdCBxdWVyeSBvbiAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IGJlY2F1c2UgaXQgaGFzIG5vIHNpbmdsZSBwcmltYXJ5LWtleSBjb2x1bW4gdG8gY291bnQgZGlzdGluY3QgdmFsdWVzIG9mYClcbiAgICB9XG5cbiAgICBjb25zdCBkaXN0aW5jdFByZWZpeCA9IHRoaXMuX2Rpc3RpbmN0ID8gXCJESVNUSU5DVCBcIiA6IFwiXCJcbiAgICBjb25zdCBjb3VudEV4cHJlc3Npb24gPSBoYXNTaW5nbGVDb2x1bW5QcmltYXJ5S2V5XG4gICAgICA/IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKCkpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSl9YFxuICAgICAgOiBcIipcIlxuICAgIGxldCBzcWwgPSBgQ09VTlQoJHtkaXN0aW5jdFByZWZpeH0ke2NvdW50RXhwcmVzc2lvbn0pYFxuXG4gICAgaWYgKHRoaXMuZHJpdmVyLmdldFR5cGUoKSA9PSBcInBnc3FsXCIpIHNxbCArPSBcIjo6aW50XCJcblxuICAgIHNxbCArPSBcIiBBUyBjb3VudFwiXG5cbiAgICAvLyBDbG9uZSBxdWVyeSBhbmQgZXhlY3V0ZSBjb3VudFxuICAgIGNvbnN0IGNvdW50UXVlcnkgPSB0aGlzLmNsb25lKClcblxuICAgIGNvdW50UXVlcnkuX2Rpc3RpbmN0ID0gZmFsc2VcbiAgICBjb3VudFF1ZXJ5Ll9zZWxlY3RzID0gW11cbiAgICBjb3VudFF1ZXJ5LnNlbGVjdChzcWwpXG5cbiAgICBjb25zdCByZXN1bHRzID0gLyoqIEB0eXBlIHt7Y291bnQ6IG51bWJlcn1bXX0gKi8gKGF3YWl0IGNvdW50UXVlcnkuX2V4ZWN1dGVRdWVyeSh7XG4gICAgICBsb2dOYW1lOiBjb3VudFF1ZXJ5LnF1ZXJ5TG9nTmFtZShcIkNvdW50XCIpXG4gICAgfSkpXG5cbiAgICAvLyBUaGUgcXVlcnkgaXNuJ3QgZ3JvdXBlZCBhbmQgYSBzaW5nbGUgcmVzdWx0IGhhcyBiZWVuIGdpdmVuXG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID09IDEpIHtcbiAgICAgIHJldHVybiByZXN1bHRzWzBdLmNvdW50XG4gICAgfVxuXG4gICAgLy8gVGhlIHF1ZXJ5IG1heSBiZSBncm91cGVkIGFuZCBhIGxvdCBvZiBkaWZmZXJlbnQgY291bnRzIGEgZ2l2ZW5cbiAgICBsZXQgY291bnRSZXN1bHQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBpZiAoIShcImNvdW50XCIgaW4gcmVzdWx0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGNvdW50IHJlc3VsdFwiKVxuICAgICAgfVxuXG4gICAgICBjb3VudFJlc3VsdCArPSByZXN1bHQuY291bnRcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2luYXRlZCBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudCBhZnRlciBwYWdpbmF0aW9uIGlzIGFwcGxpZWQuXG4gICAqL1xuICBhc3luYyBwYWdpbmF0ZWRDb3VudCgpIHtcbiAgICBjb25zdCBjb3VudFF1ZXJ5ID0gdGhpcy5jbG9uZSgpXG4gICAgY29uc3QgY291bnRTcWwgPSB0aGlzLmRyaXZlci5nZXRUeXBlKCkgPT0gXCJwZ3NxbFwiID8gXCJDT1VOVCgqKTo6aW50XCIgOiBcIkNPVU5UKCopXCJcbiAgICBjb25zdCBzcWwgPSBbXG4gICAgICBgU0VMRUNUICR7Y291bnRTcWx9IEFTICR7dGhpcy5kcml2ZXIucXVvdGVDb2x1bW4oXCJjb3VudFwiKX1gLFxuICAgICAgYEZST00gKCR7Y291bnRRdWVyeS50b1NxbCgpfSkgQVMgJHt0aGlzLmRyaXZlci5xdW90ZVRhYmxlKFwicGFnaW5hdGVkX2NvdW50X3Jvd3NcIil9YFxuICAgIF0uam9pbihcIiBcIilcbiAgICBjb25zdCByZXN1bHRzID0gLyoqIEB0eXBlIHt7Y291bnQ6IG51bWJlcn1bXX0gKi8gKGF3YWl0IHRoaXMuZHJpdmVyLnF1ZXJ5KFxuICAgICAgc3FsLFxuICAgICAge2xvZ05hbWU6IHRoaXMucXVlcnlMb2dOYW1lKFwiQ291bnRcIiksIHNpZ25hbDogdGhpcy5fc2lnbmFsfVxuICAgICkpXG5cbiAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSB8fCAhKFwiY291bnRcIiBpbiByZXN1bHRzWzBdKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBjb3VudCByZXN1bHRcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1swXS5jb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuU2VsZWN0QXJndW1lbnRUeXBlfSBzZWxlY3QgLSBTZWxlY3QuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBzZWxlY3QuXG4gICAqL1xuICBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0KSkge1xuICAgICAgZm9yIChjb25zdCBzZWxlY3RFbnRyeSBvZiBzZWxlY3QpIHtcbiAgICAgICAgdGhpcy5zZWxlY3Qoc2VsZWN0RW50cnkpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IHRyaW1tZWRTZWxlY3QgPSBzZWxlY3QudHJpbSgpXG5cbiAgICAgIGlmICgvXlthLXpBLVpfXVthLXpBLVowLTlfXSokLy50ZXN0KHRyaW1tZWRTZWxlY3QpKSB7XG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgICAgICBjb25zdCBjb2x1bW5OYW1lID0gYXR0cmlidXRlTWFwW3RyaW1tZWRTZWxlY3RdIHx8IHRyaW1tZWRTZWxlY3RcbiAgICAgICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSB0aGlzLnJvb3RUYWJsZVJlZmVyZW5jZSgpXG4gICAgICAgIGNvbnN0IHF1YWxpZmllZENvbHVtbiA9IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgICAgICByZXR1cm4gc3VwZXIuc2VsZWN0KHF1YWxpZmllZENvbHVtbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPYmplY3QgZm9ybSBrZXllZCBieSB0YXJnZXQgbW9kZWwgbmFtZSwgZS5nLiBgLnNlbGVjdCh7QWNjb3VudDogW1wiaWRcIl19KWAuXG4gICAgLy8gVGhlc2UgbGltaXQgdGhlIGF0dHJpYnV0ZXMgbG9hZGVkIGZvciBwcmVsb2FkZWQgcmVsYXRpb25zaGlwIHRhcmdldHNcbiAgICAvLyByYXRoZXIgdGhhbiB0aGUgcm9vdCBxdWVyeSdzIFNFTEVDVCBjbGF1c2UuXG4gICAgaWYgKGlzUGxhaW5PYmplY3Qoc2VsZWN0KSkge1xuICAgICAgdGhpcy5fbWVyZ2VQcmVsb2FkU2VsZWN0KHRoaXMuX3ByZWxvYWRTZWxlY3RzLCBzZWxlY3QpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1cGVyLnNlbGVjdChzZWxlY3QpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIGRlZmF1bHQgY29sdW1ucyBwbHVzIHRoZSBnaXZlbiBleHRyYSBzZWxlY3RzIGZvciBwcmVsb2FkZWRcbiAgICogcmVsYXRpb25zaGlwIHRhcmdldHMsIGtleWVkIGJ5IHRhcmdldCBtb2RlbCBuYW1lLCBlLmcuXG4gICAqIGAuc2VsZWN0c0V4dHJhKHtBY2NvdW50OiBbXCIoU0VMRUNUIGNvdW50KCopIEZST00gcHJvamVjdHMpIEFTIHByb2plY3RzX2NvdW50XCJdfSlgLlxuICAgKiBVbmxpa2UgYHNlbGVjdCh7Li4ufSlgLCB3aGljaCBuYXJyb3dzIHRvIG9ubHkgdGhlIGxpc3RlZCBjb2x1bW5zLCB0aGlzIGtlZXBzXG4gICAqIHRoZSBkZWZhdWx0IGBTRUxFQ1QgKmAgY29sdW1ucyBhbmQgYWRkcyB0aGUgZXh0cmFzIG9uIHRvcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXT59IHNlbGVjdCAtIEV4dHJhIHNlbGVjdHMga2V5ZWQgYnkgdGFyZ2V0IG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnksIGZvciBjaGFpbmluZy5cbiAgICovXG4gIHNlbGVjdHNFeHRyYShzZWxlY3QpIHtcbiAgICB0aGlzLl9tZXJnZVByZWxvYWRTZWxlY3QodGhpcy5fcHJlbG9hZFNlbGVjdHNFeHRyYSwgc2VsZWN0KVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgYW4gb2JqZWN0LWZvcm0gcHJlbG9hZCBzZWxlY3QgKGtleWVkIGJ5IHRhcmdldCBtb2RlbCBuYW1lKSBpbnRvIHRoZVxuICAgKiBnaXZlbiB0YXJnZXQgbWFwLCBkZS1kdXBsaWNhdGluZyBhdHRyaWJ1dGUvZXhwcmVzc2lvbiBlbnRyaWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gdGFyZ2V0IC0gTWFwIHRvIG1lcmdlIGludG8uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10+fSBzZWxlY3QgLSBPYmplY3QtZm9ybSBzZWxlY3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tZXJnZVByZWxvYWRTZWxlY3QodGFyZ2V0LCBzZWxlY3QpIHtcbiAgICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGF0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKHNlbGVjdCkpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzID0gQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSA/IGF0dHJpYnV0ZXMgOiBbYXR0cmlidXRlc11cblxuICAgICAgaWYgKCF0YXJnZXRbbW9kZWxOYW1lXSkgdGFyZ2V0W21vZGVsTmFtZV0gPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBub3JtYWxpemVkQXR0cmlidXRlcykge1xuICAgICAgICBpZiAoIXRhcmdldFttb2RlbE5hbWVdLmluY2x1ZGVzKGF0dHJpYnV0ZSkpIHRhcmdldFttb2RlbE5hbWVdLnB1c2goYXR0cmlidXRlKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvb3QgdGFibGUgcmVmZXJlbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJvb3QgdGFibGUgcmVmZXJlbmNlIGZvciBxdWVyeSBzZWxlY3QgcXVhbGlmaWNhdGlvbi5cbiAgICovXG4gIHJvb3RUYWJsZVJlZmVyZW5jZSgpIHtcbiAgICBjb25zdCBmcm9tcyA9IHRoaXMuZ2V0RnJvbXMoKVxuICAgIGNvbnN0IGxhc3RGcm9tID0gZnJvbXNbZnJvbXMubGVuZ3RoIC0gMV1cblxuICAgIGlmIChsYXN0RnJvbSAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxhc3RGcm9tKS50YWJsZU5hbWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnRhYmxlTmFtZVxuICAgIH1cblxuICAgIGlmIChsYXN0RnJvbSAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxhc3RGcm9tKS5wbGFpbiA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgcGFyc2VkUmVmZXJlbmNlID0gcGFyc2VGcm9tUGxhaW5UYWJsZVJlZmVyZW5jZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGFzdEZyb20pLnBsYWluKVxuXG4gICAgICBpZiAocGFyc2VkUmVmZXJlbmNlKSByZXR1cm4gcGFyc2VkUmVmZXJlbmNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge01DfSAtIFRoZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIm1vZGVsQ2xhc3Mgbm90IHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRpb25zaGlwIHRhcmdldCB0byB0aGlzIHF1ZXJ5J3MgcGh5c2ljYWwgZGF0YWJhc2UgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBDYW5vbmljYWwgcmVsYXRpb25zaGlwIHRhcmdldC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBRdWVyeS1ib3VuZCByZWxhdGlvbnNoaXAgdGFyZ2V0LlxuICAgKi9cbiAgYmluZE1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbiBiYXNlIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgam9pbiBiYXNlIHBhdGguXG4gICAqL1xuICBnZXRKb2luQmFzZVBhdGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2pvaW5CYXNlUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvaW4gdHJhY2tlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vam9pbi10cmFja2VyLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGpvaW4gdHJhY2tlci5cbiAgICovXG4gIGdldEpvaW5UcmFja2VyKCkge1xuICAgIHJldHVybiB0aGlzLl9qb2luVHJhY2tlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZvcmNlIHF1YWxpZnkgYmFzZSB0YWJsZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBxdWFsaWZ5IGJhc2UgdGFibGUuXG4gICAqL1xuICBnZXRGb3JjZVF1YWxpZnlCYXNlVGFibGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZvcmNlUXVhbGlmeUJhc2VUYWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGpvaW4gYmFzZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBqb2luQmFzZVBhdGggLSBKb2luIGJhc2UgcGF0aC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhlIHF1ZXJ5IHdpdGggdXBkYXRlZCBiYXNlIHBhdGguXG4gICAqL1xuICBzZXRKb2luQmFzZVBhdGgoam9pbkJhc2VQYXRoKSB7XG4gICAgdGhpcy5fam9pbkJhc2VQYXRoID0gam9pbkJhc2VQYXRoXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBqb2luQmFzZVBhdGggLSBKb2luIGJhc2UgcGF0aC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBzY29wZWQgcXVlcnkuXG4gICAqL1xuICB3aXRoSm9pblBhdGgoam9pbkJhc2VQYXRoKSB7XG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5CYXNlUGF0aCA9IGpvaW5CYXNlUGF0aFxuICAgIHNjb3BlZFF1ZXJ5Ll9qb2luVHJhY2tlciA9IHRoaXMuX2pvaW5UcmFja2VyXG5cbiAgICByZXR1cm4gc2NvcGVkUXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgdGFibGUgbmFtZSBmb3Igam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRhYmxlIG5hbWUgZm9yIHBhdGguXG4gICAqL1xuICBfcmVzb2x2ZVRhYmxlTmFtZUZvckpvaW5QYXRoKHBhdGgpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzb2x2ZU1vZGVsQ2xhc3NGb3JKb2luUGF0aChwYXRoKS50YWJsZU5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBtb2RlbCBjbGFzcyBmb3Igam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gSm9pbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIF9yZXNvbHZlTW9kZWxDbGFzc0ZvckpvaW5QYXRoKHBhdGgpIHtcbiAgICBsZXQgbW9kZWxDbGFzcyA9IHRoaXMuX2pvaW5UcmFja2VyLmdldFJvb3RNb2RlbENsYXNzKClcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciAke21vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIG1vZGVsQ2xhc3MgPSB0aGlzLmJpbmRNb2RlbENsYXNzKHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHJldHVybnMge3t0YWJsZU5hbWU6IHN0cmluZywgYWxpYXM6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gVGhlIGVudHJ5LlxuICAgKi9cbiAgX3JlZ2lzdGVySm9pblBhdGgocGF0aCkge1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuX3Jlc29sdmVUYWJsZU5hbWVGb3JKb2luUGF0aChwYXRoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2pvaW5UcmFja2VyLnJlZ2lzdGVyUGF0aChwYXRoLCB0YWJsZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9pbiB0YWJsZSByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVW5xdW90ZWQgdGFibGUgcmVmZXJlbmNlIChhbGlhcyBvciB0YWJsZSBuYW1lKS5cbiAgICovXG4gIGdldEpvaW5UYWJsZVJlZmVyZW5jZShwYXRoKSB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLl9qb2luVHJhY2tlci5nZXRFbnRyeShwYXRoKSB8fCB0aGlzLl9yZWdpc3RlckpvaW5QYXRoKHBhdGgpXG5cbiAgICByZXR1cm4gZW50cnkuYWxpYXMgfHwgZW50cnkudGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgcmVmZXJlbmNlIGZvciBqb2luLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gcGF0aCAtIEpvaW4gcGF0aCBzZWdtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBVbnF1b3RlZCB0YWJsZSByZWZlcmVuY2UgKGFsaWFzIG9yIHRhYmxlIG5hbWUpLlxuICAgKi9cbiAgZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpIHtcbiAgICBjb25zdCBmdWxsUGF0aCA9IHRoaXMuX2pvaW5CYXNlUGF0aC5jb25jYXQocGF0aClcblxuICAgIHJldHVybiB0aGlzLmdldEpvaW5UYWJsZVJlZmVyZW5jZShmdWxsUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBmb3Igam9pbi5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd9IHBhdGggLSBKb2luIHBhdGggc2VnbWVudHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVvdGVkIHRhYmxlIG5hbWUgZm9yIGpvaW4gcGF0aC5cbiAgICovXG4gIGdldFRhYmxlRm9ySm9pbiguLi5wYXRoKSB7XG4gICAgcmV0dXJuIHRoaXMuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY29wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvciB8IHN0cmluZyB8IHN0cmluZ1tdfSBwYXRoT3JTY29wZURlc2NyaXB0b3IgLSBTY29wZSBkZXNjcmlwdG9yIG9yIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gW21heWJlU2NvcGVEZXNjcmlwdG9yXSAtIFNjb3BlIGRlc2NyaXB0b3Igd2hlbiBwYXRoIGlzIGdpdmVuLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBTY29wZWQgcXVlcnkuXG4gICAqL1xuICBzY29wZShwYXRoT3JTY29wZURlc2NyaXB0b3IsIG1heWJlU2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgaWYgKGlzTW9kZWxTY29wZURlc2NyaXB0b3IocGF0aE9yU2NvcGVEZXNjcmlwdG9yKSAmJiAhbWF5YmVTY29wZURlc2NyaXB0b3IpIHtcbiAgICAgIHJldHVybiB0aGlzLl9hcHBseVJvb3RTY29wZShwYXRoT3JTY29wZURlc2NyaXB0b3IpXG4gICAgfVxuXG4gICAgaWYgKCFtYXliZVNjb3BlRGVzY3JpcHRvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2NvcGUocGF0aCwgZGVzY3JpcHRvcikgcmVxdWlyZXMgYSBzY29wZSBkZXNjcmlwdG9yXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGx5Sm9pblBhdGhTY29wZSh7XG4gICAgICBqb2luUGF0aDogbm9ybWFsaXplU2NvcGVQYXRoKC8qKiBAdHlwZSB7c3RyaW5nIHwgc3RyaW5nW119ICovIChwYXRoT3JTY29wZURlc2NyaXB0b3IpKSxcbiAgICAgIHNjb3BlRGVzY3JpcHRvcjogbWF5YmVTY29wZURlc2NyaXB0b3JcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcm9vdCBzY29wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gc2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgX2FwcGx5Um9vdFNjb3BlKHNjb3BlRGVzY3JpcHRvcikge1xuICAgIGlmICghaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihzY29wZURlc2NyaXB0b3IpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZSgpIGV4cGVjdHMgYSBkZXNjcmlwdG9yIHJldHVybmVkIGJ5IGRlZmluZVNjb3BlKC4uLikuc2NvcGUoLi4uKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlTW9kZWxDbGFzcyA9IGJhY2tlbmRTY29wZU1vZGVsQ2xhc3Moc2NvcGVEZXNjcmlwdG9yKVxuXG4gICAgaWYgKHNjb3BlTW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSAhPT0gdGhpcy5nZXRNb2RlbENsYXNzKCkuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFwcGx5ICR7c2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3MubmFtZX0gc2NvcGUgdG8gJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBxdWVyeWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge3RoaXMgfCB2b2lkfSAqLyAoc2NvcGVEZXNjcmlwdG9yLmNhbGxiYWNrKHtcbiAgICAgIGRyaXZlcjogdGhpcy5kcml2ZXIsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKSxcbiAgICAgIHF1ZXJ5OiB0aGlzLFxuICAgICAgdGFibGU6IHRoaXMucm9vdFRhYmxlUmVmZXJlbmNlKClcbiAgICB9LCAuLi5zY29wZURlc2NyaXB0b3Iuc2NvcGVBcmdzKSlcblxuICAgIHJldHVybiBzY29wZWRRdWVyeSB8fCB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBqb2luIHBhdGggc2NvcGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbi1wYXRoIHNjb3BlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3Muam9pblBhdGggLSBKb2luIHBhdGggcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgcXVlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IGFyZ3Muc2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgX2FwcGx5Sm9pblBhdGhTY29wZSh7am9pblBhdGgsIHNjb3BlRGVzY3JpcHRvcn0pIHtcbiAgICBpZiAoIWlzTW9kZWxTY29wZURlc2NyaXB0b3Ioc2NvcGVEZXNjcmlwdG9yKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2NvcGUoKSBleHBlY3RzIGEgZGVzY3JpcHRvciByZXR1cm5lZCBieSBkZWZpbmVTY29wZSguLi4pLnNjb3BlKC4uLilcIilcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsSm9pblBhdGggPSB0aGlzLmdldEpvaW5CYXNlUGF0aCgpLmNvbmNhdChqb2luUGF0aClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5fcmVzb2x2ZU1vZGVsQ2xhc3NGb3JKb2luUGF0aChmdWxsSm9pblBhdGgpXG5cbiAgICBjb25zdCBzY29wZU1vZGVsQ2xhc3MgPSBiYWNrZW5kU2NvcGVNb2RlbENsYXNzKHNjb3BlRGVzY3JpcHRvcilcblxuICAgIGlmIChzY29wZU1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkgIT09IHRhcmdldE1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFwcGx5ICR7c2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3MubmFtZX0gc2NvcGUgdG8gam9pbiBwYXRoICR7ZnVsbEpvaW5QYXRoLmpvaW4oXCIuXCIpfSAoJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9KWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSB0aGlzLmJ1aWxkSm9pblNjb3BlUXVlcnkodGFyZ2V0TW9kZWxDbGFzcywgZnVsbEpvaW5QYXRoKVxuICAgIGNvbnN0IG9yaWdpbmFsSm9pbkNvdW50ID0gc2NvcGVkUXVlcnkuX2pvaW5zLmxlbmd0aFxuICAgIGNvbnN0IG9yaWdpbmFsV2hlcmVDb3VudCA9IHNjb3BlZFF1ZXJ5Ll93aGVyZXMubGVuZ3RoXG4gICAgY29uc3QgYXBwbGllZFF1ZXJ5ID0gLyoqIEB0eXBlIHt0eXBlb2Ygc2NvcGVkUXVlcnkgfCB2b2lkfSAqLyAoc2NvcGVEZXNjcmlwdG9yLmNhbGxiYWNrKHtcbiAgICAgIGRyaXZlcjogc2NvcGVkUXVlcnkuZHJpdmVyLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IFsuLi5mdWxsSm9pblBhdGhdLFxuICAgICAgcXVlcnk6IHNjb3BlZFF1ZXJ5LFxuICAgICAgdGFibGU6IHNjb3BlZFF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG4gICAgfSwgLi4uc2NvcGVEZXNjcmlwdG9yLnNjb3BlQXJncykpIHx8IHNjb3BlZFF1ZXJ5XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5LmdldEZyb21zKCkubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5nZXRGcm9tcygpLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5LmdldEdyb3VwcygpLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuZ2V0R3JvdXBzKCkubGVuZ3RoIHx8XG4gICAgICBhcHBsaWVkUXVlcnkuZ2V0U2VsZWN0cygpLmxlbmd0aCAhPT0gc2NvcGVkUXVlcnkuZ2V0U2VsZWN0cygpLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9vcmRlcnMubGVuZ3RoICE9PSBzY29wZWRRdWVyeS5fb3JkZXJzLmxlbmd0aCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9saW1pdCAhPT0gc2NvcGVkUXVlcnkuX2xpbWl0IHx8XG4gICAgICBhcHBsaWVkUXVlcnkuX29mZnNldCAhPT0gc2NvcGVkUXVlcnkuX29mZnNldCB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9wYWdlICE9PSBzY29wZWRRdWVyeS5fcGFnZSB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9wZXJQYWdlICE9PSBzY29wZWRRdWVyeS5fcGVyUGFnZSB8fFxuICAgICAgYXBwbGllZFF1ZXJ5Ll9kaXN0aW5jdCAhPT0gc2NvcGVkUXVlcnkuX2Rpc3RpbmN0IHx8XG4gICAgICBPYmplY3Qua2V5cyhhcHBsaWVkUXVlcnkuX3ByZWxvYWQpLmxlbmd0aCAhPT0gT2JqZWN0LmtleXMoc2NvcGVkUXVlcnkuX3ByZWxvYWQpLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSm9pbmVkLXBhdGggc2NvcGVzIG1heSBvbmx5IGFkZCB3aGVyZSguLi4pIGFuZCBqb2lucyguLi4pIGNsYXVzZXNcIilcbiAgICB9XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5Ll9qb2lucy5sZW5ndGggPiBvcmlnaW5hbEpvaW5Db3VudCkge1xuICAgICAgZm9yIChjb25zdCBqb2luIG9mIGFwcGxpZWRRdWVyeS5fam9pbnMuc2xpY2Uob3JpZ2luYWxKb2luQ291bnQpKSB7XG4gICAgICAgIGlmIChqb2luIGluc3RhbmNlb2YgSm9pbk9iamVjdCkge1xuICAgICAgICAgIHRoaXMuX2pvaW5zLnB1c2gobmV3IEpvaW5PYmplY3Qoam9pbi5vYmplY3QsIGZ1bGxKb2luUGF0aCkpXG4gICAgICAgIH0gZWxzZSBpZiAoam9pbiBpbnN0YW5jZW9mIEpvaW5QbGFpbikge1xuICAgICAgICAgIHRoaXMuX2pvaW5zLnB1c2goam9pbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLl9qb2lucy5wdXNoKGpvaW4pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYXBwbGllZFF1ZXJ5Ll93aGVyZXMubGVuZ3RoID4gb3JpZ2luYWxXaGVyZUNvdW50KSB7XG4gICAgICB0aGlzLl93aGVyZXMucHVzaCguLi5hcHBsaWVkUXVlcnkuX3doZXJlcy5zbGljZShvcmlnaW5hbFdoZXJlQ291bnQpKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBqb2luIHNjb3BlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gam9pblBhdGggLSBKb2luIHBhdGguXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVF1ZXJ5TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2NvcGVkIGpvaW4gcXVlcnkuXG4gICAqL1xuICBidWlsZEpvaW5TY29wZVF1ZXJ5KHRhcmdldE1vZGVsQ2xhc3MsIGpvaW5QYXRoKSB7XG4gICAgY29uc3Qgc2NvcGVkUXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAoXG4gICAgICB0aGlzLl9vcGVyYXRpb25cbiAgICAgICAgPyB0aGlzLl9vcGVyYXRpb24uZm9yTW9kZWwodGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgICAgOiB0YXJnZXRNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG4gICAgKVxuXG4gICAgc2NvcGVkUXVlcnkuX2pvaW5UcmFja2VyID0gdGhpcy5fam9pblRyYWNrZXJcbiAgICBzY29wZWRRdWVyeS5fam9pbkJhc2VQYXRoID0gam9pblBhdGhcbiAgICBzY29wZWRRdWVyeS5fZm9yY2VRdWFsaWZ5QmFzZVRhYmxlID0gdHJ1ZVxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95IGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3lBbGwoKSB7XG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IHRoaXMudG9BcnJheSgpXG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgYnVsayBVUERBVEUgb24gYWxsIHJvd3MgbWF0Y2hpbmcgdGhlIHF1ZXJ5J3MgV0hFUkVcbiAgICogY2xhdXNlLiBCeXBhc3NlcyBtb2RlbCBsaWZlY3ljbGUgY2FsbGJhY2tzIOKAlCB1c2UgdGhpcyBmb3JcbiAgICogZWZmaWNpZW50IGJhdGNoIHVwZGF0ZXMgd2hlcmUgcGVyLXJvdyBob29rcyBhcmVuJ3QgbmVlZGVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZXMg4oaSIHZhbHVlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdXBkYXRlIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZUFsbChkYXRhKSB7XG4gICAgY29uc3QgZHJpdmVyID0gdGhpcy5kcml2ZXJcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhkYXRhKVxuXG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHNldENvbHMgPSBlbnRyaWVzLm1hcCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGtleSlcbiAgICAgIGNvbnN0IHF1b3RlZCA9IHZhbHVlID09PSBudWxsID8gXCJOVUxMXCIgOiBkcml2ZXIucXVvdGUodmFsdWUpXG5cbiAgICAgIHJldHVybiBgJHtkcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9ID0gJHtxdW90ZWR9YFxuICAgIH0pLmpvaW4oXCIsIFwiKVxuXG4gICAgY29uc3Qgam9pbnNTcWwgPSBuZXcgSm9pbnNQYXJzZXIoe3ByZXR0eTogZmFsc2UsIHF1ZXJ5OiB0aGlzfSkudG9TcWwoKVxuICAgIGNvbnN0IHdoZXJlU3FsID0gbmV3IFdoZXJlUGFyc2VyKHtwcmV0dHk6IGZhbHNlLCBxdWVyeTogdGhpc30pLnRvU3FsKClcbiAgICBsZXQgc3FsXG5cbiAgICBpZiAoam9pbnNTcWwubGVuZ3RoID4gMCkge1xuICAgICAgLy8gVXNlIGEgc3VicXVlcnkgZm9yIGNyb3NzLWRyaXZlciBjb21wYXRpYmlsaXR5IChTUUxpdGVcbiAgICAgIC8vIGRvZXNuJ3Qgc3VwcG9ydCBVUERBVEUgLi4uIEpPSU4pLlxuICAgICAgY29uc3QgcGsgPSBkcml2ZXIucXVvdGVDb2x1bW4odGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpKVxuICAgICAgY29uc3QgcXQgPSBkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpXG5cbiAgICAgIHNxbCA9IGBVUERBVEUgJHtxdH0gU0VUICR7c2V0Q29sc30gV0hFUkUgJHtwa30gSU4gKFNFTEVDVCAke3F0fS4ke3BrfSBGUk9NICR7cXR9JHtqb2luc1NxbH0ke3doZXJlU3FsfSlgXG4gICAgfSBlbHNlIHtcbiAgICAgIHNxbCA9IGBVUERBVEUgJHtkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfSBTRVQgJHtzZXRDb2xzfSR7d2hlcmVTcWx9YFxuICAgIH1cblxuICAgIGF3YWl0IGRyaXZlci5xdWVyeShzcWwsIHtsb2dOYW1lOiB0aGlzLnF1ZXJ5TG9nTmFtZShcIlVwZGF0ZSBBbGxcIiksIHNpZ25hbDogdGhpcy5fc2lnbmFsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gcmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpbmQuXG4gICAqL1xuICBhc3luYyBmaW5kKHJlY29yZElkKSB7XG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7e1trZXk6IHN0cmluZ106IG51bWJlciB8IHN0cmluZ319ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBjb25kaXRpb25zW3RoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKV0gPSByZWNvcmRJZFxuXG4gICAgY29uc3QgbmV3UXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgbmV3UXVlcnkud2hlcmUoY29uZGl0aW9ucylcblxuICAgIGNvbnN0IHJlY29yZCA9IChhd2FpdCBuZXdRdWVyeS5maXJzdCgpKVxuXG4gICAgaWYgKCFyZWNvcmQpIHtcbiAgICAgIHRocm93IG5ldyBSZWNvcmROb3RGb3VuZEVycm9yKGBDb3VsZG4ndCBmaW5kICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gd2l0aCAnJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCl9Jz0ke3JlY29yZElkfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VRdWVyeU1vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLmNsb25lKCkpXG5cbiAgICBuZXdRdWVyeS53aGVyZShjb25kaXRpb25zKVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ld1F1ZXJ5LmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgY3JlYXRlIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCB0aGlzLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcblxuICAgIGlmIChyZWNvcmQuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgIH1cblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkgb3IgZmFpbC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgbm90IGZvdW5kXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KGFyZzogSW5zdGFuY2VUeXBlPE1DPikgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBpbml0aWFsaXplIGJ5LlxuICAgKi9cbiAgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmIChyZWNvcmQpIHJldHVybiByZWNvcmRcblxuICAgIGNvbnN0IG5ld1JlY29yZCA9IHRoaXMuYnVpbGQoY29uZGl0aW9ucylcblxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2sobmV3UmVjb3JkKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByZWNvcmQgb3duZWQgYnkgdGhlIHF1ZXJ5J3Mgb3BlcmF0aW9uLCB3aGVuIHByZXNlbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8TUM+fSAtIEJ1aWx0IHJlY29yZC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPE1DPn0gKi8gKG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpKVxuXG4gICAgaWYgKHRoaXMuX29wZXJhdGlvbikgdGhpcy5fb3BlcmF0aW9uLmJpbmRSZWNvcmQocmVjb3JkKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSByZWNvcmQgb3duZWQgYnkgdGhlIHF1ZXJ5J3Mgb3BlcmF0aW9uLCB3aGVuIHByZXNlbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIENyZWF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMgPSB7fSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHRoaXMuYnVpbGQoYXR0cmlidXRlcylcblxuICAgIGF3YWl0IHJlY29yZC5zYXZlKClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlyc3QuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IHRoaXMuY2xvbmUoKS5saW1pdCgxKS5yZW9yZGVyKGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKCkpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKHRoaXMuZ2V0TW9kZWxDbGFzcygpLm9yZGVyYWJsZUNvbHVtbigpKX1gKVxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBuZXdRdWVyeS50b0FycmF5KClcblxuICAgIHJldHVybiByZXN1bHRzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgYXN5bmMgbGFzdCgpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKClcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5jbG9uZSgpLnJlb3JkZXIoYCR7dGhpcy5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke3RoaXMuZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfSBERVNDYCkubGltaXQoMSkudG9BcnJheSgpXG5cbiAgICByZXR1cm4gcmVzdWx0c1swXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoZSBwcmVsb2FkLlxuICAgKi9cbiAgcHJlbG9hZChkYXRhKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkUmVjb3JkKGRhdGEpXG4gICAgaW5jb3Jwb3JhdGUodGhpcy5fcHJlbG9hZCwgbm9ybWFsaXplZFByZWxvYWQpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBxdWVyeSByZXN1bHRzIGludG8gbW9kZWwgaW5zdGFuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxJbnN0YW5jZVR5cGU8TUM+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IG1vZGVscyA9IFtdXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICBjb25zdCBtb2RlbCA9IHRoaXMuYnVpbGQoKVxuXG4gICAgICBtb2RlbC5sb2FkRXhpc3RpbmdSZWNvcmQocmVzdWx0KVxuICAgICAgbW9kZWxzLnB1c2gobW9kZWwpXG4gICAgfVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyByZWNvcmQgc28gdGhhdFxuICAgIC8vIGF1dG8tcHJlbG9hZCBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICBtb2RlbC5fbG9hZENvaG9ydCA9IG1vZGVsc1xuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9wcmVsb2FkKS5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcmVsb2FkZXIgPSBuZXcgUHJlbG9hZGVyKHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICBtb2RlbHMsXG4gICAgICAgIHByZWxvYWQ6IHRoaXMuX3ByZWxvYWQsXG4gICAgICAgIHByZWxvYWRTZWxlY3RzOiB0aGlzLl9wcmVsb2FkU2VsZWN0cyxcbiAgICAgICAgcHJlbG9hZFNlbGVjdHNFeHRyYTogdGhpcy5fcHJlbG9hZFNlbGVjdHNFeHRyYVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgcHJlbG9hZGVyLnJ1bigpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3dpdGhDb3VudC5sZW5ndGggPiAwICYmIG1vZGVscy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBydW5XaXRoQ291bnQoe1xuICAgICAgICBlbnRyaWVzOiB0aGlzLl93aXRoQ291bnQsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgICAgbW9kZWxzXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9xdWVyeURhdGEubGVuZ3RoID4gMCAmJiBtb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgcnVuUXVlcnlEYXRhKHtcbiAgICAgICAgZW50cmllczogdGhpcy5fcXVlcnlEYXRhLFxuICAgICAgICByb290TW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgICByb290TW9kZWxzOiBtb2RlbHNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIHF1ZXJ5IHJlc3VsdHMgdG8gYXJyYXkgb2YgbW9kZWwgaW5zdGFuY2VzXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEluc3RhbmNlVHlwZTxNQz4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUGx1Y2tzIG9uZSBvciBtb3JlIGNvbHVtbnMgZGlyZWN0bHkgZnJvbSB0aGUgZGF0YWJhc2Ugd2l0aG91dCBpbnN0YW50aWF0aW5nIG1vZGVscy5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd8c3RyaW5nW119IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcGx1Y2suXG4gICAqL1xuICBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgY29uc3QgZmxhdENvbHVtbnMgPSBjb2x1bW5zLmZsYXQoKVxuXG4gICAgaWYgKGZsYXRDb2x1bW5zLmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFibGVOYW1lID0gbW9kZWxDbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBmbGF0Q29sdW1ucy5tYXAoKGNvbHVtbikgPT4gYXR0cmlidXRlTWFwW2NvbHVtbl0gfHwgY29sdW1uKVxuXG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUXVlcnlNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5jbG9uZSgpKVxuXG4gICAgcXVlcnkuX3ByZWxvYWQgPSB7fVxuICAgIHF1ZXJ5Ll9zZWxlY3RzID0gW11cblxuICAgIGNvbHVtbk5hbWVzLmZvckVhY2goKGNvbHVtbk5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHNlbGVjdFNxbCA9IGAke3RoaXMuZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX0uJHt0aGlzLmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgIHF1ZXJ5LnNlbGVjdChzZWxlY3RTcWwpXG4gICAgfSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5fZXhlY3V0ZVF1ZXJ5KHtsb2dOYW1lOiBxdWVyeS5xdWVyeUxvZ05hbWUoXCJQbHVja1wiKX0pXG5cbiAgICBpZiAoY29sdW1uTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBbY29sdW1uTmFtZV0gPSBjb2x1bW5OYW1lc1xuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVtjb2x1bW5OYW1lXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgcm93SGFzaCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICByZXR1cm4gY29sdW1uTmFtZXMubWFwKChjb2x1bW5OYW1lKSA9PiByb3dIYXNoW2NvbHVtbk5hbWVdKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmUod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZSh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVNb2RlbENsYXNzSGFzaCh7XG4gICAgICAgICAgaGFzaDogcmVzb2x2ZWRIYXNoLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLFxuICAgICAgICAgIHF1YWxpZnlCYXNlVGFibGUsXG4gICAgICAgICAgcXVlcnk6IHRoaXNcbiAgICAgICAgfSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhmYWxsYmFja0hhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3VwZXIud2hlcmUoZmFsbGJhY2tIYXNoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCB0eXBlIG9mIHdoZXJlOiAke3R5cGVvZiB3aGVyZX0gKCR7d2hlcmUuY29uc3RydWN0b3IubmFtZX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLiBTdXBwb3J0cyBgc2Aga2V5IGZvciBzb3J0aW5nIChlLmcuLCBge3M6IFwibmFtZSBhc2NcIn1gKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYW5kIHNvcnQgYXBwbGllZC5cbiAgICovXG4gIHJhbnNhY2socGFyYW1zKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSBwYXJhbXNcbiAgICBjb25zdCBncm91cCA9IG5vcm1hbGl6ZVJhbnNhY2tHcm91cCh0aGlzLmdldE1vZGVsQ2xhc3MoKSwgZmlsdGVyUGFyYW1zKVxuXG4gICAgYXBwbHlSYW5zYWNrR3JvdXAoe2dyb3VwLCBxdWVyeTogdGhpc30pXG5cbiAgICBpZiAodHlwZW9mIHMgPT09IFwic3RyaW5nXCIgJiYgcy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc29ydHMgPSBwYXJzZVJhbnNhY2tTb3J0KHRoaXMuZ2V0TW9kZWxDbGFzcygpLCBzKVxuXG4gICAgICBmb3IgKGNvbnN0IHNvcnREZWYgb2Ygc29ydHMpIHtcbiAgICAgICAgdGhpcy5vcmRlcih7Y29sdW1uOiBzb3J0RGVmLmF0dHJpYnV0ZSwgZGlyZWN0aW9uOiBzb3J0RGVmLmRpcmVjdGlvbn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlIG5vdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyBxdWVyeSBpbnN0YW5jZVxuICAgKi9cbiAgd2hlcmVOb3Qod2hlcmUpIHtcbiAgICBpZiAodHlwZW9mIHdoZXJlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiBzdXBlci53aGVyZU5vdCh3aGVyZSlcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH0gPSBzcGxpdFdoZXJlSGFzaCh7aGFzaDogd2hlcmUsIG1vZGVsQ2xhc3M6IHRoaXMuZ2V0TW9kZWxDbGFzcygpfSlcbiAgICAgIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoOiB3aGVyZSwgbW9kZWxDbGFzczogdGhpcy5nZXRNb2RlbENsYXNzKCl9KVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmpvaW5zKGpvaW5PYmplY3QpXG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhyZXNvbHZlZEhhc2gpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcXVhbGlmeUJhc2VUYWJsZSA9IHRoaXMuZ2V0Rm9yY2VRdWFsaWZ5QmFzZVRhYmxlKCkgfHwgT2JqZWN0LmtleXMoam9pbk9iamVjdCkubGVuZ3RoID4gMFxuICAgICAgICB0aGlzLl93aGVyZXMucHVzaChuZXcgV2hlcmVOb3QobmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgICAgICAgIGhhc2g6IHJlc29sdmVkSGFzaCxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmdldE1vZGVsQ2xhc3MoKSxcbiAgICAgICAgICBxdWFsaWZ5QmFzZVRhYmxlLFxuICAgICAgICAgIHF1ZXJ5OiB0aGlzXG4gICAgICAgIH0pKSlcbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGZhbGxiYWNrSGFzaCkubGVuZ3RoID4gMCkge1xuICAgICAgICBzdXBlci53aGVyZU5vdChmYWxsYmFja0hhc2gpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHR5cGUgb2Ygd2hlcmU6ICR7dHlwZW9mIHdoZXJlfSAoJHt3aGVyZS5jb25zdHJ1Y3Rvci5uYW1lfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgbG9nIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBRdWVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVlcnkgbG9nIG5hbWUuXG4gICAqL1xuICBxdWVyeUxvZ05hbWUob3BlcmF0aW9uKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9ICR7b3BlcmF0aW9ufWBcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyB0aGlzIHF1ZXJ5IGFzIGEgc3luYyBzY29wZSBvbiB0aGUgY3VycmVudCBzeW5jIGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERlY2xhcmVkIHNjb3BlIGFuZCBwdWxsIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGN1cnJlbnRTeW5jQ2xpZW50KCkuc3luYyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIERlYWN0aXZhdGVzIHRoaXMgcXVlcnkncyBzeW5jIHNjb3BlIG9uIHRoZSBjdXJyZW50IHN5bmMgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY29wZSBpcyBkZWFjdGl2YXRlZC5cbiAgICovXG4gIGFzeW5jIHVuc3luYygpIHtcbiAgICBhd2FpdCBjdXJyZW50U3luY0NsaWVudCgpLnVuc3luYyh0aGlzKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSByYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tHcm91cH0gYXJncy5ncm91cCAtIE5vcm1hbGl6ZWQgUmFuc2FjayBncm91cC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5UmFuc2Fja0dyb3VwKHtncm91cCwgcXVlcnl9KSB7XG4gIGNvbnN0IHdoZXJlID0gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSlcblxuICBpZiAod2hlcmUpIHtcbiAgICBxdWVyeS5fd2hlcmVzLnB1c2god2hlcmUpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgZ3JvdXAgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBhcmdzLmdyb3VwIC0gTm9ybWFsaXplZCBSYW5zYWNrIGdyb3VwLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIENvbWJpbmVkIHdoZXJlIGNsYXVzZS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSYW5zYWNrR3JvdXBXaGVyZSh7Z3JvdXAsIHF1ZXJ5fSkge1xuICAvKipcbiAgICogV2hlcmVzLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi93aGVyZS1iYXNlLmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgY29uc3Qgd2hlcmVzID0gW11cblxuICBmb3IgKGNvbnN0IGNvbmRpdGlvbiBvZiBncm91cC5jb25kaXRpb25zKSB7XG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pXG5cbiAgICBpZiAod2hlcmUpIHdoZXJlcy5wdXNoKHdoZXJlKVxuICB9XG5cbiAgZm9yIChjb25zdCBncm91cGluZyBvZiBncm91cC5ncm91cGluZ3MpIHtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkUmFuc2Fja0dyb3VwV2hlcmUoe2dyb3VwOiBncm91cGluZywgcXVlcnl9KVxuXG4gICAgaWYgKHdoZXJlKSB3aGVyZXMucHVzaCh3aGVyZSlcbiAgfVxuXG4gIGlmICh3aGVyZXMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcbiAgaWYgKHdoZXJlcy5sZW5ndGggPT09IDEpIHJldHVybiB3aGVyZXNbMF1cblxuICByZXR1cm4gbmV3IFdoZXJlQ29tYmluYXRvcih7XG4gICAgY29tYmluYXRvcjogZ3JvdXAuY29tYmluYXRvcixcbiAgICBxdWVyeSxcbiAgICB3aGVyZXNcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIHJhbnNhY2sgY29uZGl0aW9uIHdoZXJlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBDb25kaXRpb24gd2hlcmUgY2xhdXNlLlxuICovXG5mdW5jdGlvbiBidWlsZFJhbnNhY2tDb25kaXRpb25XaGVyZSh7Y29uZGl0aW9uLCBxdWVyeX0pIHtcbiAgLyoqXG4gICAqIFdoZXJlcy5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0W119ICovXG4gIGNvbnN0IHdoZXJlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGUgb2YgY29uZGl0aW9uLmF0dHJpYnV0ZXMpIHtcbiAgICB3aGVyZXMucHVzaChidWlsZFJhbnNhY2tBdHRyaWJ1dGVXaGVyZSh7YXR0cmlidXRlLCBjb25kaXRpb24sIHF1ZXJ5fSkpXG4gIH1cblxuICBpZiAod2hlcmVzLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG4gIGlmICh3aGVyZXMubGVuZ3RoID09PSAxKSByZXR1cm4gd2hlcmVzWzBdXG5cbiAgcmV0dXJuIG5ldyBXaGVyZUNvbWJpbmF0b3Ioe1xuICAgIGNvbWJpbmF0b3I6IGNvbmRpdGlvbi5jb21iaW5hdG9yLFxuICAgIHF1ZXJ5LFxuICAgIHdoZXJlc1xuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgd2hlcmUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGFyZ3MuY29uZGl0aW9uIC0gTm9ybWFsaXplZCBSYW5zYWNrIGNvbmRpdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vd2hlcmUtYmFzZS5qc1wiKS5kZWZhdWx0fSAtIEF0dHJpYnV0ZSB3aGVyZSBjbGF1c2UuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZVdoZXJlKHthdHRyaWJ1dGUsIGNvbmRpdGlvbiwgcXVlcnl9KSB7XG4gIGNvbnN0IGhhc2ggPSBidWlsZFJhbnNhY2tBdHRyaWJ1dGVIYXNoKHthdHRyaWJ1dGUsIGNvbmRpdGlvbn0pXG4gIGNvbnN0IGpvaW5PYmplY3QgPSBidWlsZEpvaW5PYmplY3RGcm9tV2hlcmVIYXNoKHtoYXNoLCBtb2RlbENsYXNzOiBxdWVyeS5nZXRNb2RlbENsYXNzKCl9KVxuXG4gIGlmIChPYmplY3Qua2V5cyhqb2luT2JqZWN0KS5sZW5ndGggPiAwKSB7XG4gICAgcXVlcnkuam9pbnMoam9pbk9iamVjdClcbiAgfVxuXG4gIGNvbnN0IHdoZXJlID0gbmV3IFdoZXJlTW9kZWxDbGFzc0hhc2goe1xuICAgIGhhc2gsXG4gICAgbW9kZWxDbGFzczogcXVlcnkuZ2V0TW9kZWxDbGFzcygpLFxuICAgIHF1YWxpZnlCYXNlVGFibGU6IHRydWUsXG4gICAgcXVlcnlcbiAgfSlcblxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJub3RfZXFcIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9pblwiKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIiAmJiAhY29uZGl0aW9uLnZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBXaGVyZU5vdCh3aGVyZSlcbiAgfVxuXG4gIHJldHVybiB3aGVyZVxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgcmFuc2FjayBhdHRyaWJ1dGUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrQXR0cmlidXRlfSBhcmdzLmF0dHJpYnV0ZSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0NvbmRpdGlvbn0gYXJncy5jb25kaXRpb24gLSBOb3JtYWxpemVkIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmFuc2Fja0F0dHJpYnV0ZUhhc2goe2F0dHJpYnV0ZSwgY29uZGl0aW9ufSkge1xuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJlcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiaW5cIiB8fCBjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm5vdF9lcVwiIHx8IGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwibm90X2luXCIpIHtcbiAgICByZXR1cm4gYnVpbGROZXN0ZWRSYW5zYWNrSGFzaCh7YXR0cmlidXRlLCB2YWx1ZTogY29uZGl0aW9uLnZhbHVlfSlcbiAgfVxuXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcIm51bGxcIikge1xuICAgIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tIYXNoKHthdHRyaWJ1dGUsIHZhbHVlOiBudWxsfSlcbiAgfVxuXG4gIHJldHVybiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe1xuICAgIGF0dHJpYnV0ZSxcbiAgICBvcGVyYXRvcjogcmFuc2Fja1R1cGxlT3BlcmF0b3IoY29uZGl0aW9uLnByZWRpY2F0ZSksXG4gICAgdmFsdWU6IHJhbnNhY2tUdXBsZVZhbHVlKGNvbmRpdGlvbilcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIEZpbmFsIHZhbHVlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOZXN0ZWQgaGFzaCBzdWl0YWJsZSBmb3IgcXVlcnkgd2hlcmUgbm9kZXMuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkTmVzdGVkUmFuc2Fja0hhc2goe2F0dHJpYnV0ZSwgdmFsdWV9KSB7XG4gIC8qKlxuICAgKiBIYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgaGFzaCA9IHtbYXR0cmlidXRlLmF0dHJpYnV0ZU5hbWVdOiB2YWx1ZX1cblxuICBmb3IgKGxldCBpbmRleCA9IGF0dHJpYnV0ZS5wYXRoLmxlbmd0aCAtIDE7IGluZGV4ID49IDA7IGluZGV4IC09IDEpIHtcbiAgICBoYXNoID0ge1thdHRyaWJ1dGUucGF0aFtpbmRleF1dOiBoYXNofVxuICB9XG5cbiAgcmV0dXJuIGhhc2hcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIG5lc3RlZCByYW5zYWNrIHR1cGxlIGhhc2guXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0F0dHJpYnV0ZX0gYXJncy5hdHRyaWJ1dGUgLSBOb3JtYWxpemVkIFJhbnNhY2sgYXR0cmlidXRlLlxuICogQHBhcmFtIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IGFyZ3Mub3BlcmF0b3IgLSBUdXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBGaW5hbCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTmVzdGVkIHR1cGxlIGhhc2ggc3VpdGFibGUgZm9yIHF1ZXJ5LndoZXJlLlxuICovXG5mdW5jdGlvbiBidWlsZE5lc3RlZFJhbnNhY2tUdXBsZUhhc2goe2F0dHJpYnV0ZSwgb3BlcmF0b3IsIHZhbHVlfSkge1xuICAvKipcbiAgICogSGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IGhhc2ggPSB7XG4gICAgW2F0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lXTogW1thdHRyaWJ1dGUuYXR0cmlidXRlTmFtZSwgb3BlcmF0b3IsIHZhbHVlXV1cbiAgfVxuXG4gIGZvciAobGV0IGluZGV4ID0gYXR0cmlidXRlLnBhdGgubGVuZ3RoIC0gMTsgaW5kZXggPj0gMDsgaW5kZXggLT0gMSkge1xuICAgIGhhc2ggPSB7W2F0dHJpYnV0ZS5wYXRoW2luZGV4XV06IGhhc2h9XG4gIH1cblxuICByZXR1cm4gaGFzaFxufVxuXG4vKipcbiAqIFJ1bnMgcmFuc2FjayB0dXBsZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrUHJlZGljYXRlfSBwcmVkaWNhdGUgLSBSYW5zYWNrIHByZWRpY2F0ZS5cbiAqIEByZXR1cm5zIHtcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9IC0gUXVlcnkgdHVwbGUgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIHJhbnNhY2tUdXBsZU9wZXJhdG9yKHByZWRpY2F0ZSkge1xuICBpZiAocHJlZGljYXRlID09PSBcImd0XCIgfHwgcHJlZGljYXRlID09PSBcImd0ZXFcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRcIiB8fCBwcmVkaWNhdGUgPT09IFwibHRlcVwiKSB7XG4gICAgcmV0dXJuIHByZWRpY2F0ZVxuICB9XG5cbiAgcmV0dXJuIFwibGlrZVwiXG59XG5cbi8qKlxuICogUnVucyByYW5zYWNrIHR1cGxlIHZhbHVlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tDb25kaXRpb259IGNvbmRpdGlvbiAtIFJhbnNhY2sgY29uZGl0aW9uLlxuICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFF1ZXJ5IHR1cGxlIHZhbHVlLlxuICovXG5mdW5jdGlvbiByYW5zYWNrVHVwbGVWYWx1ZShjb25kaXRpb24pIHtcbiAgaWYgKGNvbmRpdGlvbi5wcmVkaWNhdGUgPT09IFwiY29udFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX0lYFxuICBpZiAoY29uZGl0aW9uLnByZWRpY2F0ZSA9PT0gXCJzdGFydFwiKSByZXR1cm4gYCR7Y29uZGl0aW9uLnZhbHVlfSVgXG4gIGlmIChjb25kaXRpb24ucHJlZGljYXRlID09PSBcImVuZFwiKSByZXR1cm4gYCUke2NvbmRpdGlvbi52YWx1ZX1gXG5cbiAgcmV0dXJuIGNvbmRpdGlvbi52YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByZWxhdGlvbnNoaXAuXG4gKi9cbmZ1bmN0aW9uIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShtb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lKSB7XG4gIHJldHVybiBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gQXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgcmVzb2x2ZWQgY29sdW1uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICBjb25zdCBhdHRyaWJ1dGVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gIGlmIChhdHRyaWJ1dGVNYXBba2V5XSkgcmV0dXJuIGF0dHJpYnV0ZU1hcFtrZXldXG5cbiAgY29uc3QgY29sdW1uTWFwID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgY29uc3QgdW5kZXJzY29yZWQgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoa2V5KVxuXG4gIHJldHVybiBjb2x1bW5NYXBba2V5XSB8fCBjb2x1bW5NYXBbdW5kZXJzY29yZWRdIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJ1bnMgc3BsaXQgd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3tyZXNvbHZlZEhhc2g6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZmFsbGJhY2tIYXNoOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAtIFNwbGl0IGhhc2hlcy5cbiAqL1xuZnVuY3Rpb24gc3BsaXRXaGVyZUhhc2goe2hhc2gsIG1vZGVsQ2xhc3N9KSB7XG4gIC8qKlxuICAgKiBSZXNvbHZlZCBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCByZXNvbHZlZEhhc2ggPSB7fVxuICAvKipcbiAgICogRmFsbGJhY2sgaGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgZmFsbGJhY2tIYXNoID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCBpc05lc3RlZCA9IGlzUGxhaW5PYmplY3QodmFsdWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gZ2V0UmVsYXRpb25zaGlwQnlOYW1lKG1vZGVsQ2xhc3MsIGtleSlcblxuICAgIGlmIChpc05lc3RlZCkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcCkge1xuICAgICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc3VsdCA9IHNwbGl0V2hlcmVIYXNoKHtoYXNoOiB2YWx1ZSwgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc30pXG4gICAgICAgIGNvbnN0IG5lc3RlZFJlc29sdmVkS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5yZXNvbHZlZEhhc2gpXG4gICAgICAgIGNvbnN0IG5lc3RlZEZhbGxiYWNrS2V5cyA9IE9iamVjdC5rZXlzKG5lc3RlZFJlc3VsdC5mYWxsYmFja0hhc2gpXG5cbiAgICAgICAgaWYgKG5lc3RlZFJlc29sdmVkS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmVzb2x2ZWRIYXNoW2tleV0gPSBuZXN0ZWRSZXN1bHQucmVzb2x2ZWRIYXNoXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkRmFsbGJhY2tLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0YXJnZXRNb2RlbENsYXNzLnRhYmxlTmFtZSgpXG5cbiAgICAgICAgICBpZiAoIWZhbGxiYWNrSGFzaFt0YWJsZU5hbWVdKSBmYWxsYmFja0hhc2hbdGFibGVOYW1lXSA9IHt9XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihmYWxsYmFja0hhc2hbdGFibGVOYW1lXSwgbmVzdGVkUmVzdWx0LmZhbGxiYWNrSGFzaClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2tIYXNoW2tleV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwICYmIGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICByZXNvbHZlZEhhc2hba2V5XSA9IG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSB7XG4gICAgICAgIHJlc29sdmVkSGFzaFtjb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmYWxsYmFja0hhc2hba2V5XSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtyZXNvbHZlZEhhc2gsIGZhbGxiYWNrSGFzaH1cbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGpvaW4gb2JqZWN0IGZyb20gd2hlcmUgaGFzaC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmhhc2ggLSBXaGVyZSBoYXNoLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBKb2luIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaCwgbW9kZWxDbGFzc30pIHtcbiAgLyoqXG4gICAqIEpvaW4gb2JqZWN0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBqb2luT2JqZWN0ID0ge31cblxuICBmb3IgKGNvbnN0IGtleSBpbiBoYXNoKSB7XG4gICAgY29uc3QgdmFsdWUgPSBoYXNoW2tleV1cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBnZXRSZWxhdGlvbnNoaXBCeU5hbWUobW9kZWxDbGFzcywga2V5KVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIGNvbnRpbnVlXG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG4gICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCBuZXN0ZWRKb2luT2JqZWN0ID0gYnVpbGRKb2luT2JqZWN0RnJvbVdoZXJlSGFzaCh7aGFzaDogdmFsdWUsIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3N9KVxuXG4gICAgICBqb2luT2JqZWN0W2tleV0gPSBPYmplY3Qua2V5cyhuZXN0ZWRKb2luT2JqZWN0KS5sZW5ndGggPiAwID8gbmVzdGVkSm9pbk9iamVjdCA6IHRydWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGhhc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpKSB7XG4gICAgICBqb2luT2JqZWN0W2tleV0gPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGpvaW5PYmplY3Rcbn1cblxuY29uc3QgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibm90RXFcIiwgXCJndFwiLCBcImd0ZXFcIiwgXCJsdFwiLCBcImx0ZXFcIiwgXCJsaWtlXCIsIFwiPlwiLCBcIj49XCIsIFwiPFwiLCBcIjw9XCJdKVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRvciAtIFJhdyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcmV0dXJucyB7XCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwifSAtIE5vcm1hbGl6ZWQgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gKi8gKFxuICAgIG9wZXJhdG9yQWxpYXNlc1svKiogQHR5cGUge1wiPFwiIHwgXCI8PVwiIHwgXCI+XCIgfCBcIj49XCJ9ICovIChvcGVyYXRvcildIHx8IG9wZXJhdG9yXG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGlzIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHR1cGxlVmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgaXMgYSByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUuXG4gKi9cbmZ1bmN0aW9uIGlzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKHR1cGxlVmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHR1cGxlVmFsdWUpIHx8IHR1cGxlVmFsdWUubGVuZ3RoIDwgMykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIHR5cGVvZiB0dXBsZVZhbHVlWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgdHlwZW9mIHR1cGxlVmFsdWVbMV0gPT09IFwic3RyaW5nXCIgJiZcbiAgICByZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9ycy5oYXModHVwbGVWYWx1ZVsxXSlcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59IC0gTm9ybWFsaXplZCB0dXBsZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIHR5cGU6ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge0FycmF5PFtzdHJpbmcsIFwiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIiwgdW5rbm93bl0+fSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cbiAgICAvKipcbiAgICAgKiBBZGQgY29uZGl0aW9uLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvblZhbHVlIC0gQ2FuZGlkYXRlIG5lc3RlZCBjb25kaXRpb24uXG4gICAgICovXG4gICAgY29uc3QgYWRkQ29uZGl0aW9uID0gKGNvbmRpdGlvblZhbHVlKSA9PiB7XG4gICAgICBpZiAoaXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGUoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHR1cGxlID0gLyoqIEB0eXBlIHtbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwiLCB1bmtub3duLCAuLi5BcnJheTx1bmtub3duPl19ICovIChjb25kaXRpb25WYWx1ZSlcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcih0dXBsZVsxXSlcblxuICAgICAgICBub3JtYWxpemVkLnB1c2goW1xuICAgICAgICAgIHR1cGxlWzBdLFxuICAgICAgICAgIG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgICAgICB0dXBsZVsyXVxuICAgICAgICBdKVxuXG4gICAgICAgIGlmICh0dXBsZS5sZW5ndGggPiAzKSB7XG4gICAgICAgICAgZm9yIChsZXQgaW5kZXggPSAzOyBpbmRleCA8IHR1cGxlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICAgICAgYWRkQ29uZGl0aW9uKHR1cGxlW2luZGV4XSlcbiAgICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShjb25kaXRpb25WYWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlbGF0aW9uc2hpcCB3aGVyZSBjb25kaXRpb25zIG11c3QgYmUgdHVwbGVzXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25kaXRpb25WYWx1ZSkuZm9yRWFjaCgobmVzdGVkQ29uZGl0aW9uVmFsdWUpID0+IHtcbiAgICAgIGFkZENvbmRpdGlvbihuZXN0ZWRDb25kaXRpb25WYWx1ZSlcbiAgICB9KVxuICB9XG5cbiAgYWRkQ29uZGl0aW9uKHZhbHVlKVxuXG4gIGlmIChub3JtYWxpemVkLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIGNhbm5vdCBiZSBlbXB0eVwiKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIGhhcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVsYXRpb25zaGlwIHdoZXJlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBjYW4gYmUgbm9ybWFsaXplZCB0byByZWxhdGlvbnNoaXAgdHVwbGVzLlxuICovXG5mdW5jdGlvbiBoYXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSB7XG4gIHRyeSB7XG4gICAgbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh2YWx1ZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG4iXX0=