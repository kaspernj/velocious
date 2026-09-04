export type FrontendModelSearch = {
    /**
     * - Attribute name to search.
     */
    column: string;
    /**
     * - Search operator.
     */
    operator: "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq";
    /**
     * - Relationship path from root model.
     */
    path: string[];
    /**
     * - Search value.
     */
    value: ReturnType<typeof JSON.parse>;
};
export type FrontendModelTransportValue = null | boolean | number | string | object;
export type FrontendModelAttributeValue = import("./base.js").FrontendModelAttributeValue;
export type FrontendModelWithCountPayloadEntry = {
    attributeName: string;
    relationshipName: string;
    where?: Record<string, FrontendModelTransportValue>;
};
export type FrontendModelAbilitiesPayloadEntry = {
    modelName: string;
    actions: string[];
};
export type FrontendModelProjectionOptions = {
    /**
     * - Model-aware attribute select map or root-model shorthand.
     */
    select?: Record<string, string[] | string> | string | string[];
    /**
     * - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
     */
    selectsExtra?: Record<string, string[] | string> | string | string[];
    /**
     * - Relationship preload tree.
     */
    preload?: import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>;
    /**
     * - Association count spec.
     */
    withCount?: string | string[] | Record<string, boolean | {
        relationship?: string;
        where?: Record<string, FrontendModelTransportValue>;
    }>;
    /**
     * - Ability actions to compute per record.
     */
    abilities?: string[] | Record<string, string[]>;
    /**
     * - Backend query data names/spec.
     */
    queryData?: string | Array<string | Record<string, FrontendModelTransportValue>> | Record<string, FrontendModelTransportValue>;
};
export type FrontendModelEventRoutingOptions = {
    /**
     * - Query whose filters match events and whose projections shape event records.
     */
    query?: FrontendModelQuery<import("./base.js").FrontendModelClass>;
    /**
     * - Registration-local remote routing context. Its captured value partitions lifecycle server subscriptions and replaces the transport-wide context for this registration.
     */
    requestContext?: import("../remote-request-context.js").RemoteRequestContext;
};
export type FrontendModelEventOptionsObject = FrontendModelProjectionOptions & FrontendModelEventRoutingOptions;
export type FrontendModelEventOptions = FrontendModelEventOptionsObject | FrontendModelQuery<import("./base.js").FrontendModelClass>;
export type FrontendModelProjectionPayload = {
    /**
     * - Normalized select map.
     */
    select?: Record<string, string[]>;
    /**
     * - Normalized extra select map.
     */
    selectsExtra?: Record<string, string[]>;
    /**
     * - Normalized preload tree.
     */
    preload?: import("../database/query/index.js").NestedPreloadRecord;
    /**
     * - Normalized count specs.
     */
    withCount?: FrontendModelWithCountPayloadEntry[];
    /**
     * - Normalized ability specs.
     */
    abilities?: FrontendModelAbilitiesPayloadEntry[];
    /**
     * - Normalized queryData spec.
     */
    queryData?: FrontendModelTransportValue;
};
export type FrontendModelEventFilterPayload = {
    /**
     * - Relationship joins needed for matching.
     */
    joins?: Record<string, FrontendModelTransportValue>;
    /**
     * - Search predicates needed for matching.
     */
    searches?: FrontendModelSearch[];
    /**
     * - Structured where predicates needed for matching.
     */
    where?: Record<string, FrontendModelTransportValue>;
};
export type FrontendModelEventFilterPayloadEntry = FrontendModelEventFilterPayload & {
    key: string;
};
export type FrontendModelEventQueryPayload = {
    /**
     * - Stable event filter key, or null when no filter is present.
     */
    eventFilterKey: string | null;
    /**
     * - Normalized event filter payload, or null when unfiltered.
     */
    eventFilterPayload: FrontendModelEventFilterPayload | null;
    /**
     * - Normalized event serialization projection payload.
     */
    projectionPayload: FrontendModelProjectionPayload;
};
export type FrontendModelEventOptionsPayload = FrontendModelEventQueryPayload & {
    requestContext: import("../remote-request-context.js").RemoteRequestContext | undefined;
};
export type FrontendModelSort = {
    /**
     * - Attribute name to sort by.
     */
    column: string;
    /**
     * - Sort direction.
     */
    direction: "asc" | "desc";
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelGroup = {
    /**
     * - Attribute name to group by.
     */
    column: string;
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelPluck = {
    /**
     * - Attribute name to pluck.
     */
    column: string;
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
/**
 * FrontendModelSearch type.
 * @typedef {object} FrontendModelSearch
 * @property {string} column - Attribute name to search.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {string[]} path - Relationship path from root model.
 * @property {ReturnType<typeof JSON.parse>} value - Search value.
 */
/**
 * FrontendModelTransportValue type.
 * @typedef {null | boolean | number | string | object} FrontendModelTransportValue
 */
/**
 * FrontendModelAttributeValue type.
 * @typedef {import("./base.js").FrontendModelAttributeValue} FrontendModelAttributeValue
 */
/**
 * Defines this typedef.
 * @typedef {{attributeName: string, relationshipName: string, where?: Record<string, FrontendModelTransportValue>}} FrontendModelWithCountPayloadEntry
 */
/**
 * Defines this typedef.
 * @typedef {{modelName: string, actions: string[]}} FrontendModelAbilitiesPayloadEntry
 */
/**
 * FrontendModelProjectionOptions type.
 * @typedef {object} FrontendModelProjectionOptions
 * @property {Record<string, string[] | string> | string | string[]} [select] - Model-aware attribute select map or root-model shorthand.
 * @property {Record<string, string[] | string> | string | string[]} [selectsExtra] - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
 * @property {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} [preload] - Relationship preload tree.
 * @property {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, FrontendModelTransportValue>}>} [withCount] - Association count spec.
 * @property {string[] | Record<string, string[]>} [abilities] - Ability actions to compute per record.
 * @property {string | Array<string | Record<string, FrontendModelTransportValue>> | Record<string, FrontendModelTransportValue>} [queryData] - Backend query data names/spec.
 */
/**
 * FrontendModelEventRoutingOptions type.
 * @typedef {object} FrontendModelEventRoutingOptions
 * @property {FrontendModelQuery<import("./base.js").FrontendModelClass>} [query] - Query whose filters match events and whose projections shape event records.
 * @property {import("../remote-request-context.js").RemoteRequestContext} [requestContext] - Registration-local remote routing context. Its captured value partitions lifecycle server subscriptions and replaces the transport-wide context for this registration.
 */
/**
 * Defines this typedef.
 * @typedef {FrontendModelProjectionOptions & FrontendModelEventRoutingOptions} FrontendModelEventOptionsObject
 */
/**
 * FrontendModelEventOptions type.
 * @typedef {FrontendModelEventOptionsObject | FrontendModelQuery<import("./base.js").FrontendModelClass>} FrontendModelEventOptions
 */
/**
 * FrontendModelProjectionPayload type.
 * @typedef {object} FrontendModelProjectionPayload
 * @property {Record<string, string[]>} [select] - Normalized select map.
 * @property {Record<string, string[]>} [selectsExtra] - Normalized extra select map.
 * @property {import("../database/query/index.js").NestedPreloadRecord} [preload] - Normalized preload tree.
 * @property {FrontendModelWithCountPayloadEntry[]} [withCount] - Normalized count specs.
 * @property {FrontendModelAbilitiesPayloadEntry[]} [abilities] - Normalized ability specs.
 * @property {FrontendModelTransportValue} [queryData] - Normalized queryData spec.
 */
/**
 * FrontendModelEventFilterPayload type.
 * @typedef {object} FrontendModelEventFilterPayload
 * @property {Record<string, FrontendModelTransportValue>} [joins] - Relationship joins needed for matching.
 * @property {FrontendModelSearch[]} [searches] - Search predicates needed for matching.
 * @property {Record<string, FrontendModelTransportValue>} [where] - Structured where predicates needed for matching.
 */
/**
 * Defines this typedef.
 * @typedef {FrontendModelEventFilterPayload & {key: string}} FrontendModelEventFilterPayloadEntry
 */
/**
 * FrontendModelEventQueryPayload type.
 * @typedef {object} FrontendModelEventQueryPayload
 * @property {string | null} eventFilterKey - Stable event filter key, or null when no filter is present.
 * @property {FrontendModelEventFilterPayload | null} eventFilterPayload - Normalized event filter payload, or null when unfiltered.
 * @property {FrontendModelProjectionPayload} projectionPayload - Normalized event serialization projection payload.
 */
/**
 * FrontendModelEventOptionsPayload type.
 * @typedef {FrontendModelEventQueryPayload & {requestContext: import("../remote-request-context.js").RemoteRequestContext | undefined}} FrontendModelEventOptionsPayload
 */
/**
 * FrontendModelSort type.
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelGroup type.
 * @typedef {object} FrontendModelGroup
 * @property {string} column - Attribute name to group by.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelPluck type.
 * @typedef {object} FrontendModelPluck
 * @property {string} column - Attribute name to pluck.
 * @property {string[]} path - Relationship path from root model.
 */
/** Error raised when a frontend-model query descriptor is malformed. */
export declare class FrontendModelQueryError extends Error {
    /**
     * Creates a frontend-model query error.
     * @param {string} message - Error message.
     */
    constructor(message: string);
}
/**
 * Runs the normalizePreload helper.
 * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord> | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("../database/query/index.js").NestedPreloadRecord} - Normalized preload.
 */
export declare function normalizePreload(preload: import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord> | boolean | undefined | null): import("../database/query/index.js").NestedPreloadRecord;
/**
 * Runs the normalizeSearchOperator helper.
 * @param {string} operator - Raw search operator.
 * @returns {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} - Normalized operator.
 */
export declare function normalizeSearchOperator(operator: string): "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq";
/**
 * Runs the normalizeJoins helper.
 * @param {ReturnType<typeof JSON.parse>} joins - Join payload.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Normalized relationship descriptor joins.
 */
export declare function normalizeJoins(joins: ReturnType<typeof JSON.parse>): Record<string, ReturnType<typeof JSON.parse>>;
/**
 * Normalize any supported sort payload into flat sort descriptors.
 * @param {ReturnType<typeof JSON.parse>} sort - Sort payload.
 * @returns {FrontendModelSort[]} - Normalized sort definitions.
 */
export declare function normalizeSort(sort: ReturnType<typeof JSON.parse>): FrontendModelSort[];
/**
 * Normalize any supported group payload into flat group descriptors.
 * @param {ReturnType<typeof JSON.parse>} group - Group payload.
 * @returns {FrontendModelGroup[]} - Normalized group definitions.
 */
export declare function normalizeGroup(group: ReturnType<typeof JSON.parse>): FrontendModelGroup[];
/**
 * Normalize any supported pluck payload into flat pluck descriptors.
 * @param {ReturnType<typeof JSON.parse>} pluck - Pluck payload.
 * @returns {FrontendModelPluck[]} - Normalized pluck definitions.
 */
export declare function normalizePluck(pluck: ReturnType<typeof JSON.parse>): FrontendModelPluck[];
/**
 * Query wrapper for frontend model commands.
 * @template {import("./base.js").FrontendModelClass} T
 */
export default class FrontendModelQuery<T extends import("./base.js").FrontendModelClass> {
    modelClass: T;
    _preload: import("../database/query/index.js").NestedPreloadRecord;
    _joins: {};
    _where: {};
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    _select: Record<string, string[]>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    _selectsExtra: Record<string, string[]>;
    _distinct: boolean;
    _limit: number | null;
    _offset: number | null;
    _page: number | null;
    _perPage: number | null;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} */
    _withCount: Array<{
        attributeName: string;
        relationshipName: string;
        where?: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<string | Record<string, ReturnType<typeof JSON.parse>>>} */
    _queryData: Array<string | Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Per-record ability spec. Normalized to a list of
     * `{modelName, actions}` entries — one entry per model that should
     * have ability results attached. The root query's model class
     * name is implicit via `"__root__"` when the caller used the flat
     * array form.
     * @type {Array<{modelName: string, actions: string[]}>}
     */
    _abilities: Array<{
        modelName: string;
        actions: string[];
    }>;
    /**
     * Ransack.
     * @type {Record<string, ReturnType<typeof JSON.parse>>[]} */
    _ransack: Record<string, ReturnType<typeof JSON.parse>>[];
    /**
     * Searches.
     * @type {FrontendModelSearch[]} */
    _searches: FrontendModelSearch[];
    /**
     * Sort.
     * @type {FrontendModelSort[]} */
    _sort: FrontendModelSort[];
    /**
     * Group.
     * @type {FrontendModelGroup[]} */
    _group: FrontendModelGroup[];
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {T} args.modelClass - Frontend model class.
     * @param {import("../database/query/index.js").NestedPreloadRecord} [args.preload] - Preload map.
     */
    constructor({ modelClass, preload }: {
        modelClass: T;
        preload?: import("../database/query/index.js").NestedPreloadRecord;
    });
    /**
     * Tell the backend to evaluate one or more ability actions against
     * each returned record (and its preloaded relations, when keyed by
     * model name) and ship the results back so the frontend can read
     * them via `record.can(action)`.
     *
     * Flat form — applies to the query's own model class:
     *   ```
     *   const timelogs = await Timelog.where({taskId})
     *     .abilities(["update", "destroy"])
     *     .toArray()
     *   timelogs[0].can("update") // → boolean
     *   ```
     *
     * Keyed form — targets records by model name, useful for preloaded
     * children:
     *   ```
     *   const project = await Project
     *     .preload("timelogs")
     *     .abilities({Timelog: ["update", "destroy"]})
     *     .first()
     *   project.timelogs().loaded()[0].can("update") // → boolean
     *   ```
     *
     * Keys in the keyed form are the backend model names (as returned by
     * `ModelClass.getModelName()` / the `modelName` field of the
     * frontend-model resource config). Values are the ability-action
     * strings — typically `"update"` / `"destroy"` / `"create"` /
     * `"read"`, but any custom action registered on the resource's
     * authorization ability is accepted.
     * @param {string[] | Record<string, string[]>} spec - Ability actions to request for root or named models.
     * @returns {this} - This query for chaining.
     */
    abilities(spec: string[] | Record<string, string[]>): this;
    /**
     * Runs merge ability entry.
     * @param {{modelName: string, actions: string[]}} entry - Normalized model ability request to append.
     * @returns {void}
     */
    _mergeAbilityEntry(entry: {
        modelName: string;
        actions: string[];
    }): void;
    /**
     * Tell the backend index query to attach one or more association
     * counts to each returned record. Parses the same shapes as the
     * backend `ModelClassQuery#withCount`, then ships the normalized
     * entries as part of the `index` command payload.
     * @param {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} spec - Relationships whose counts should be serialized.
     * @returns {this} - This query for chaining.
     */
    withCount(spec: string | string[] | Record<string, boolean | {
        relationship?: string;
        where?: Record<string, ReturnType<typeof JSON.parse>>;
    }>): this;
    /**
     * Request one or more backend queryData entries for each returned
     * record. The spec is a name or nested-record shape matching the
     * `Model.queryData(name, fn)` registrations on the backend — the
     * frontend ships only these names; the SQL fragments stay server-
     * side. All resulting aliases are attached to the root record and
     * read back with `record.queryData(aliasName)`.
     * @param {string | Array<string | Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>} spec - Backend query-data names and arguments to serialize.
     * @returns {this} - This query for chaining.
     */
    queryData(spec: string | Array<string | Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>): this;
    /**
     * Runs where.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Root-model where conditions.
     * @returns {this} - Query with merged where conditions.
     */
    where(conditions: Record<string, ReturnType<typeof JSON.parse>>): this;
    /**
     * Runs scope.
     * @param {import("../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    scope(scopeDescriptor: import("../utils/model-scope.js").ModelScopeDescriptor): this;
    /**
     * Runs ransack.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
     * @returns {this} - Query with Ransack filters and sort applied.
     */
    ransack(params: Record<string, ReturnType<typeof JSON.parse>>): this;
    /**
     * Runs select with required root attributes.
     * @param {string[]} [requiredAttributes] - Extra required attributes for the root model.
     * @returns {Record<string, string[]>} - Select map with required root attributes merged when root select exists.
     */
    selectWithRequiredRootAttributes(requiredAttributes?: string[]): Record<string, string[]>;
    /**
     * Runs preload.
     * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload to merge.
     * @returns {this} - Query with merged preloads.
     */
    preload(preload: import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>): this;
    /**
     * Runs select.
     * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
     * @returns {this} - Query with merged selected attributes.
     */
    select(select: Record<string, string[] | string> | string | string[]): this;
    /**
     * Like `select(...)`, but keeps the default serialized attributes and loads
     * the given extras in addition (for example attributes declared
     * `selectedByDefault: false`). Keyed by model name, with root-model shorthand.
     * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load, keyed by model name or root-model shorthand.
     * @returns {this} - Query with merged extra selected attributes.
     */
    selectsExtra(select: Record<string, string[] | string> | string | string[]): this;
    /**
     * Runs joins.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} joins - Relationship descriptor joins.
     * @returns {this} - Query with merged joins.
     */
    joins(joins: Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): this;
    /**
     * Returns the search result.
     * @param {string[]} path - Relationship path.
     * @param {string} column - Column or attribute name.
     * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
     * @param {ReturnType<typeof JSON.parse>} value - Search value.
     * @returns {this} - Query with appended search.
     */
    search(path: string[], column: string, operator: "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<=", value: ReturnType<typeof JSON.parse>): this;
    /**
     * Runs sort.
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {this} - Query with appended sort definitions.
     */
    sort(sort: string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): this;
    /**
     * Runs order.
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} order - Order definition(s).
     * @returns {this} - Query with appended sort definitions.
     */
    order(order: string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): this;
    /**
     * Runs group.
     * @param {string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} group - Group definition(s).
     * @returns {this} - Query with appended group definitions.
     */
    group(group: string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): this;
    /**
     * Runs distinct.
     * @param {boolean} [value] - Whether to request distinct rows.
     * @returns {this} - Query with distinct flag.
     */
    distinct(value?: boolean): this;
    /**
     * Returns the limit result.
     * @param {number} value - Maximum number of records.
     * @returns {this} - Query with limit.
     */
    limit(value: number): this;
    /**
     * Runs offset.
     * @param {number} value - Number of records to skip.
     * @returns {this} - Query with offset.
     */
    offset(value: number): this;
    /**
     * Runs page.
     * @param {number} pageNumber - 1-based page number.
     * @returns {this} - Query with page applied.
     */
    page(pageNumber: number): this;
    /**
     * Runs per page.
     * @param {number} perPage - Page size.
     * @returns {this} - Query with per-page applied.
     */
    perPage(perPage: number): this;
    /**
     * Runs clone.
     * @returns {FrontendModelQuery<T>} - Cloned query instance.
     */
    clone(): FrontendModelQuery<T>;
    /**
     * Runs get model class.
     * @returns {T} - Root model class.
     */
    getModelClass(): T;
    /**
     * Runs preload payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload preload hash when present.
     */
    preloadPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs with count payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload withCount array when present.
     */
    withCountPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs abilities payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload abilities array when present.
     */
    abilitiesPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs query data payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload queryData spec when present.
     */
    queryDataPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs select payload.
     * @param {string[]} [requiredAttributes] - Extra required attributes for root model selection.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload select hash when present.
     */
    selectPayload(requiredAttributes?: string[]): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs selects extra payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload selectsExtra hash when present.
     */
    selectsExtraPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs search payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload searches array when present.
     */
    searchPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs ransack payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload ransack hash when present.
     */
    ransackPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs joins payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload joins hash when present.
     */
    joinsPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs sort payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload sort array when present.
     */
    sortPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs group payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload group array when present.
     */
    groupPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs distinct payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload distinct flag when enabled.
     */
    distinctPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs where payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload where hash when present.
     */
    wherePayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs pagination payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload pagination params when present.
     */
    paginationPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs assert event query supported.
     * @returns {void}
     * @throws {Error} When the query contains list-only options that cannot filter a single lifecycle event.
     */
    assertEventQuerySupported(): void;
    /**
     * Runs event projection payload.
     * @returns {FrontendModelProjectionPayload} - Projection payload used when serializing lifecycle events.
     */
    eventProjectionPayload(): FrontendModelProjectionPayload;
    /**
     * Runs event filter payload.
     * @returns {FrontendModelEventFilterPayload | null} - Query pieces used to match lifecycle events.
     */
    eventFilterPayload(): FrontendModelEventFilterPayload | null;
    /**
     * Returns the eventOptionsPayload result.
     * @returns {FrontendModelEventQueryPayload} - Combined event filter and projection payload.
     */
    eventOptionsPayload(): FrontendModelEventQueryPayload;
    /**
     * Runs load.
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    load(): Promise<InstanceType<T>[]>;
    /**
     * Runs to array.
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    toArray(): Promise<InstanceType<T>[]>;
    /**
     * Runs count.
     * @returns {Promise<number>} - Number of loaded model instances.
     */
    count(): Promise<number>;
    /**
     * Runs first.
     * @returns {Promise<InstanceType<T> | null>} - First model matching query.
     */
    first(): Promise<InstanceType<T> | null>;
    /**
     * Runs last.
     * @returns {Promise<InstanceType<T> | null>} - Last model matching query.
     */
    last(): Promise<InstanceType<T> | null>;
    /**
     * Runs pluck.
     * @param {...(string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)} columns - Pluck definition(s).
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    pluck(...columns: (string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)[]): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs find.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record id.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    find(id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue): Promise<InstanceType<T>>;
    /**
     * Runs find by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T> | null>} - Found model or null.
     */
    findBy(conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T> | null>;
    /**
     * Runs find by or fail.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    findByOrFail(conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T>>;
    /**
     * Runs find or initialize by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
     */
    findOrInitializeBy(conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T>>;
    /**
     * Runs find or create by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save.
     * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
     */
    findOrCreateBy(conditions: Record<string, ReturnType<typeof JSON.parse>>, callback?: (model: InstanceType<T>) => Promise<void> | void): Promise<InstanceType<T>>;
    /**
     * Runs validated structured conditions.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Candidate structured conditions.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Validated conditions.
     */
    validatedStructuredConditions(conditions: Record<string, ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
}
/**
 * Runs the frontendModelEventOptionsPayload helper.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptions} [options] - Event query or projection options.
 * @returns {FrontendModelEventOptionsPayload} - Normalized event subscription payload.
 */
export declare function frontendModelEventOptionsPayload(modelClass: import("./base.js").FrontendModelClass, options?: FrontendModelEventOptions): FrontendModelEventOptionsPayload;
//# sourceMappingURL=query.d.ts.map