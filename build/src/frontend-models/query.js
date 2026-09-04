// @ts-check
import { resolveFrontendModelClass } from "./model-registry.js";
import { normalizeRansackGroup, parseRansackSort } from "../utils/ransack.js";
import { isModelScopeDescriptor } from "../utils/model-scope.js";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyConditions } from "../utils/model-primary-key.js";
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
export class FrontendModelQueryError extends Error {
    /**
     * Creates a frontend-model query error.
     * @param {string} message - Error message.
     */
    constructor(message) {
        super(message);
        this.name = "FrontendModelQueryError";
    }
}
/**
 * Builds a query descriptor error.
 * @param {string} message - Error message.
 * @returns {FrontendModelQueryError} - Query descriptor error.
 */
function frontendModelQueryError(message) {
    return new FrontendModelQueryError(message);
}
/**
 * Runs the normalizePreload helper.
 * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord> | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("../database/query/index.js").NestedPreloadRecord} - Normalized preload.
 */
export function normalizePreload(preload) {
    if (!preload)
        return {};
    if (preload === true)
        return {};
    if (typeof preload === "string") {
        return { [preload]: true };
    }
    if (Array.isArray(preload)) {
        /**
         * Normalized.
         * @type {import("../database/query/index.js").NestedPreloadRecord} */
        const normalized = {};
        for (const entry of preload) {
            if (typeof entry === "string") {
                normalized[entry] = true;
                continue;
            }
            if (isPlainObject(entry)) {
                mergePreloadRecord(normalized, normalizePreload(entry));
                continue;
            }
            throw frontendModelQueryError(`Invalid preload entry type: ${typeof entry}`);
        }
        return normalized;
    }
    if (!isPlainObject(preload)) {
        throw frontendModelQueryError(`Invalid preload type: ${typeof preload}`);
    }
    /**
     * Normalized.
     * @type {import("../database/query/index.js").NestedPreloadRecord} */
    const normalized = {};
    for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
        if (relationshipPreload === true || relationshipPreload === false) {
            normalized[relationshipName] = relationshipPreload;
            continue;
        }
        if (typeof relationshipPreload === "string" || Array.isArray(relationshipPreload) || isPlainObject(relationshipPreload)) {
            normalized[relationshipName] = normalizePreload(relationshipPreload);
            continue;
        }
        throw frontendModelQueryError(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`);
    }
    return normalized;
}
/**
 * Normalize the shorthand `withCount` argument from the frontend-model
 * query API into the strict internal entries used in the transport
 * payload. Shares the shape semantics with the backend normalizer in
 * `database/query/with-count.js`.
 * @param {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} spec - Association-count shorthand to normalize.
 * @returns {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} - Normalized association-count requests.
 */
function normalizeWithCountFrontend(spec) {
    if (spec == null)
        return [];
    if (typeof spec === "string") {
        return [{ attributeName: `${spec}Count`, relationshipName: spec }];
    }
    if (Array.isArray(spec)) {
        return spec.flatMap((item) => {
            if (typeof item !== "string") {
                throw new Error(`withCount array entries must be strings; got ${typeof item}`);
            }
            return [{ attributeName: `${item}Count`, relationshipName: item }];
        });
    }
    if (!isPlainObject(spec)) {
        throw new Error(`Invalid withCount spec: ${typeof spec}`);
    }
    const entries = [];
    for (const [key, value] of Object.entries(spec)) {
        if (value === true) {
            entries.push({ attributeName: `${key}Count`, relationshipName: key });
            continue;
        }
        if (value === false)
            continue;
        if (isPlainObject(value)) {
            const options = /** @type {{relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}} */ (value);
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
/**
 * Normalize a frontend `.abilities(...)` spec into a flat list of
 * `{modelName, actions}` entries. Accepts the flat actions-array
 * shorthand (applies to the query's own model class) and the keyed
 * `{ModelName: [action, ...]}` form (applies to records of that model
 * class, useful for preloaded children).
 * @param {string[] | Record<string, string[]>} spec - Ability actions grouped by model, or root-model action shorthand.
 * @param {{getModelName: () => string}} rootModelClass - Query root used by the flat action shorthand.
 * @returns {Array<{modelName: string, actions: string[]}>} - Normalized model ability requests.
 */
function normalizeAbilitiesSpec(spec, rootModelClass) {
    if (spec == null)
        return [];
    if (Array.isArray(spec)) {
        for (const action of spec) {
            if (typeof action !== "string" || action.length < 1) {
                throw new Error(`abilities flat-form actions must be non-empty strings; got ${typeof action}`);
            }
        }
        const rootModelName = rootModelClass.getModelName();
        if (!rootModelName) {
            throw new Error("abilities flat-form requires a root model class with getModelName()");
        }
        return [{ actions: [...spec], modelName: rootModelName }];
    }
    if (!isPlainObject(spec)) {
        throw new Error(`Invalid abilities spec: ${typeof spec}`);
    }
    /**
     * Entries.
     * @type {Array<{modelName: string, actions: string[]}>} */
    const entries = [];
    for (const [modelName, actions] of Object.entries(spec)) {
        if (!Array.isArray(actions)) {
            throw new Error(`abilities[${modelName}] must be an array of action names; got ${typeof actions}`);
        }
        const sanitized = actions.map((action) => {
            if (typeof action !== "string" || action.length < 1) {
                throw new Error(`abilities[${modelName}] entries must be non-empty strings; got ${typeof action}`);
            }
            return action;
        });
        entries.push({ actions: sanitized, modelName });
    }
    return entries;
}
/**
 * Runs merge preload record.
 * @param {import("../database/query/index.js").NestedPreloadRecord} targetPreload - Existing preload data.
 * @param {import("../database/query/index.js").NestedPreloadRecord} incomingPreload - New preload data.
 * @returns {void}
 */
function mergePreloadRecord(targetPreload, incomingPreload) {
    for (const [relationshipName, incomingValue] of Object.entries(incomingPreload)) {
        const existingValue = targetPreload[relationshipName];
        if (incomingValue === false) {
            targetPreload[relationshipName] = false;
            continue;
        }
        if (incomingValue === true) {
            if (existingValue === undefined) {
                targetPreload[relationshipName] = true;
            }
            continue;
        }
        if (!isPlainObject(incomingValue)) {
            throw new Error(`Invalid preload value for ${relationshipName}: ${typeof incomingValue}`);
        }
        if (isPlainObject(existingValue)) {
            mergePreloadRecord(
            /** @type {import("../database/query/index.js").NestedPreloadRecord} */ (existingValue), 
            /** @type {import("../database/query/index.js").NestedPreloadRecord} */ (incomingValue));
            continue;
        }
        targetPreload[relationshipName] = normalizePreload(incomingValue);
    }
}
/**
 * Runs normalize select.
 * @param {ReturnType<typeof JSON.parse>} select - Select payload.
 * @param {string | null} [rootModelName] - Optional root model name for shorthand select payloads.
 * @returns {Record<string, string[]>} - Normalized model-name keyed select record.
 */
function normalizeSelect(select, rootModelName = null) {
    if (!select)
        return {};
    if (typeof select === "string") {
        if (!rootModelName)
            throw new Error("Invalid select shorthand without root model name");
        return { [rootModelName]: [select] };
    }
    if (Array.isArray(select)) {
        if (!rootModelName)
            throw new Error("Invalid select shorthand without root model name");
        for (const attributeName of select) {
            if (typeof attributeName !== "string") {
                throw new Error(`Invalid select attribute for ${rootModelName}: ${typeof attributeName}`);
            }
        }
        return { [rootModelName]: Array.from(new Set(select)) };
    }
    if (!isPlainObject(select)) {
        throw new Error(`Invalid select type: ${typeof select}`);
    }
    /**
     * Normalized.
     * @type {Record<string, string[]>} */
    const normalized = {};
    for (const [modelName, selection] of Object.entries(select)) {
        if (typeof selection === "string") {
            normalized[modelName] = [selection];
            continue;
        }
        if (!Array.isArray(selection)) {
            throw new Error(`Invalid select value for ${modelName}: ${typeof selection}`);
        }
        for (const attributeName of selection) {
            if (typeof attributeName !== "string") {
                throw new Error(`Invalid select attribute for ${modelName}: ${typeof attributeName}`);
            }
        }
        normalized[modelName] = Array.from(new Set(selection));
    }
    return normalized;
}
/**
 * Runs merge select record.
 * @param {Record<string, string[]>} targetSelect - Existing select record.
 * @param {Record<string, string[]>} incomingSelect - Incoming select record.
 * @returns {void}
 */
function mergeSelectRecord(targetSelect, incomingSelect) {
    for (const [modelName, incomingAttributes] of Object.entries(incomingSelect)) {
        const existingAttributes = targetSelect[modelName] || [];
        targetSelect[modelName] = Array.from(new Set([...existingAttributes, ...incomingAttributes]));
    }
}
/**
 * Runs the normalizeSearchOperator helper.
 * @param {string} operator - Raw search operator.
 * @returns {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} - Normalized operator.
 */
export function normalizeSearchOperator(operator) {
    const operatorAliases = {
        "<": "lt",
        "<=": "lteq",
        ">": "gt",
        ">=": "gteq"
    };
    const normalizedOperator = operatorAliases[ /** @type {"<" | "<=" | ">" | ">="} */(operator)] || operator;
    const supportedOperators = new Set(["eq", "like", "notEq", "gt", "gteq", "lt", "lteq"]);
    if (!supportedOperators.has(normalizedOperator)) {
        throw frontendModelQueryError(`search operator must be one of: eq, like, notEq, gt, gteq, lt, lteq, >, >=, <, <= (got: ${operator})`);
    }
    return /** @type {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} */ (normalizedOperator);
}
/**
 * Runs merge join record.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} targetJoins - Existing join record.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} incomingJoins - Incoming join record.
 * @returns {void}
 */
function mergeJoinRecord(targetJoins, incomingJoins) {
    for (const [relationshipName, incomingValue] of Object.entries(incomingJoins)) {
        const existingValue = targetJoins[relationshipName];
        if (incomingValue === true) {
            if (existingValue === undefined) {
                targetJoins[relationshipName] = true;
            }
            continue;
        }
        if (!isPlainObject(incomingValue)) {
            throw frontendModelQueryError(`Invalid join value for ${relationshipName}: ${typeof incomingValue}`);
        }
        if (isPlainObject(existingValue)) {
            mergeJoinRecord(existingValue, incomingValue);
            continue;
        }
        if (existingValue === true) {
            targetJoins[relationshipName] = normalizeJoins(incomingValue);
            continue;
        }
        targetJoins[relationshipName] = normalizeJoins(incomingValue);
    }
}
/**
 * Runs the normalizeJoins helper.
 * @param {ReturnType<typeof JSON.parse>} joins - Join payload.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Normalized relationship descriptor joins.
 */
export function normalizeJoins(joins) {
    if (!joins)
        return {};
    if (Array.isArray(joins)) {
        /**
         * Normalized.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const normalized = {};
        for (const joinEntry of joins) {
            if (!isPlainObject(joinEntry)) {
                throw frontendModelQueryError(`Invalid joins entry type: ${typeof joinEntry}`);
            }
            mergeJoinRecord(normalized, normalizeJoins(joinEntry));
        }
        return normalized;
    }
    if (!isPlainObject(joins)) {
        throw frontendModelQueryError(`Invalid joins type: ${typeof joins}`);
    }
    /**
     * Normalized.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const normalized = {};
    for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
        if (relationshipJoin === true) {
            normalized[relationshipName] = true;
            continue;
        }
        if (isPlainObject(relationshipJoin)) {
            normalized[relationshipName] = normalizeJoins(relationshipJoin);
            continue;
        }
        throw frontendModelQueryError(`Invalid join definition for "${relationshipName}": ${typeof relationshipJoin}`);
    }
    return normalized;
}
/**
 * Runs normalize sort direction.
 * @param {ReturnType<typeof JSON.parse>} direction - Direction value.
 * @returns {"asc" | "desc"} - Normalized direction.
 */
function normalizeSortDirection(direction) {
    if (typeof direction !== "string") {
        throw frontendModelQueryError(`Invalid sort direction type: ${typeof direction}`);
    }
    const normalizedDirection = direction.trim().toLowerCase();
    if (normalizedDirection !== "asc" && normalizedDirection !== "desc") {
        throw frontendModelQueryError(`Invalid sort direction: ${direction}`);
    }
    return normalizedDirection;
}
/**
 * Check whether a value is a two-item `[column, direction]` sort tuple.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate tuple.
 * @returns {value is [string, string]} - Whether value is a sort tuple.
 */
function sortTuple(value) {
    if (!Array.isArray(value))
        return false;
    if (value.length !== 2)
        return false;
    if (typeof value[0] !== "string")
        return false;
    if (typeof value[1] !== "string")
        return false;
    if (value[0].trim().length < 1)
        return false;
    const direction = value[1].trim().toLowerCase();
    return direction === "asc" || direction === "desc";
}
/**
 * Check whether a value is a structured sort descriptor with a relationship path.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate descriptor.
 * @returns {value is {column: string, direction: string, path: string[]}} - Whether value is an explicit sort descriptor object.
 */
function sortDescriptor(value) {
    if (!isPlainObject(value))
        return false;
    if (!("column" in value) || !("direction" in value) || !("path" in value))
        return false;
    if (typeof value.column !== "string")
        return false;
    if (typeof value.direction !== "string")
        return false;
    if (!Array.isArray(value.path))
        return false;
    return value.path.every((pathEntry) => typeof pathEntry === "string");
}
/**
 * Parse a string shorthand into a sort descriptor.
 * @param {string} sortValue - Sort string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function parseSortString(sortValue, path = []) {
    const trimmed = sortValue.trim();
    if (trimmed.length < 1) {
        throw frontendModelQueryError("sort value must be a non-empty string");
    }
    if (trimmed.startsWith("-")) {
        const column = trimmed.slice(1).trim();
        if (column.length < 1) {
            throw frontendModelQueryError(`Invalid sort definition: ${sortValue}`);
        }
        return {
            column,
            direction: "desc",
            path: [...path]
        };
    }
    const sortParts = trimmed.split(/\s+/).filter(Boolean);
    if (sortParts.length > 2) {
        throw frontendModelQueryError(`Invalid sort definition: ${sortValue}`);
    }
    const column = sortParts[0];
    if (column.length < 1) {
        throw frontendModelQueryError(`Invalid sort definition: ${sortValue}`);
    }
    const direction = sortParts.length === 2
        ? normalizeSortDirection(sortParts[1])
        : "asc";
    return {
        column,
        direction,
        path: [...path]
    };
}
/**
 * Parse a tuple shorthand into a sort descriptor.
 * @param {[string, string]} sortValue - Sort tuple.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function parseSortTuple(sortValue, path = []) {
    const [columnValue, directionValue] = sortValue;
    const column = columnValue.trim();
    if (column.length < 1) {
        throw frontendModelQueryError("sort tuple column must be a non-empty string");
    }
    return {
        column,
        direction: normalizeSortDirection(directionValue),
        path: [...path]
    };
}
/**
 * Normalize a nested object sort payload into flat sort descriptors.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} sortValue - Nested sort object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelSort[]} - Normalized sort descriptors.
 */
function normalizeSortObject(sortValue, path) {
    /**
     * Normalized sorts.
     * @type {FrontendModelSort[]} */
    const normalizedSorts = [];
    for (const [sortKey, sortEntry] of Object.entries(sortValue)) {
        if (typeof sortEntry === "string") {
            normalizedSorts.push({
                column: sortKey,
                direction: normalizeSortDirection(sortEntry),
                path: [...path]
            });
            continue;
        }
        if (sortTuple(sortEntry)) {
            normalizedSorts.push(parseSortTuple(sortEntry, [...path, sortKey]));
            continue;
        }
        if (Array.isArray(sortEntry)) {
            if (sortEntry.length < 1) {
                throw frontendModelQueryError(`Invalid sort definition for "${sortKey}": empty array`);
            }
            for (const nestedSortEntry of sortEntry) {
                if (!sortTuple(nestedSortEntry)) {
                    throw frontendModelQueryError(`Invalid sort definition for "${sortKey}": expected [column, direction] tuples`);
                }
                normalizedSorts.push(parseSortTuple(nestedSortEntry, [...path, sortKey]));
            }
            continue;
        }
        if (isPlainObject(sortEntry)) {
            normalizedSorts.push(...normalizeSortObject(sortEntry, [...path, sortKey]));
            continue;
        }
        throw frontendModelQueryError(`Invalid sort definition for "${sortKey}": ${typeof sortEntry}`);
    }
    return normalizedSorts;
}
/**
 * Normalize any supported sort payload into flat sort descriptors.
 * @param {ReturnType<typeof JSON.parse>} sort - Sort payload.
 * @returns {FrontendModelSort[]} - Normalized sort definitions.
 */
export function normalizeSort(sort) {
    if (!sort)
        return [];
    if (typeof sort === "string") {
        return [parseSortString(sort)];
    }
    if (sortTuple(sort)) {
        return [parseSortTuple(sort)];
    }
    if (sortDescriptor(sort)) {
        return [{
                column: sort.column.trim(),
                direction: normalizeSortDirection(sort.direction),
                path: [...sort.path]
            }];
    }
    if (isPlainObject(sort)) {
        return normalizeSortObject(sort, []);
    }
    if (Array.isArray(sort)) {
        /**
         * Normalized.
         * @type {FrontendModelSort[]} */
        const normalized = [];
        for (const sortEntry of sort) {
            if (typeof sortEntry === "string") {
                normalized.push(parseSortString(sortEntry));
                continue;
            }
            if (sortTuple(sortEntry)) {
                normalized.push(parseSortTuple(sortEntry));
                continue;
            }
            if (sortDescriptor(sortEntry)) {
                normalized.push({
                    column: sortEntry.column.trim(),
                    direction: normalizeSortDirection(sortEntry.direction),
                    path: [...sortEntry.path]
                });
                continue;
            }
            if (isPlainObject(sortEntry)) {
                normalized.push(...normalizeSortObject(sortEntry, []));
                continue;
            }
            throw frontendModelQueryError(`Invalid sort entry type: ${typeof sortEntry}`);
        }
        return normalized;
    }
    throw frontendModelQueryError(`Invalid sort type: ${typeof sort}`);
}
/**
 * Parse a string shorthand into a group descriptor.
 * @param {string} groupValue - Group string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelGroup} - Normalized group descriptor.
 */
function parseGroupString(groupValue, path = []) {
    const trimmed = groupValue.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        throw frontendModelQueryError(`Invalid group column: ${groupValue}`);
    }
    return {
        column: trimmed,
        path: [...path]
    };
}
/**
 * Check whether a value is a structured column/path descriptor.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate descriptor.
 * @returns {value is {column: string, path: string[]}} - Whether candidate is an explicit column descriptor object.
 */
function columnPathDescriptor(value) {
    if (!isPlainObject(value))
        return false;
    if (!("column" in value) || !("path" in value))
        return false;
    if (typeof value.column !== "string")
        return false;
    if (!Array.isArray(value.path))
        return false;
    return value.path.every((pathEntry) => typeof pathEntry === "string");
}
/**
 * Normalize a nested object column projection payload into flat descriptors.
 * @template {{column: string, path: string[]}} T
 * @param {Record<string, ReturnType<typeof JSON.parse>>} value - Nested projection object.
 * @param {string[]} path - Relationship path.
 * @param {(columnValue: string, path?: string[]) => T} parseString - String projection parser.
 * @param {string} label - Projection label for errors.
 * @returns {T[]} - Normalized projection descriptors.
 */
function normalizeColumnProjectionObject(value, path, parseString, label) {
    /**
     * Normalized.
     * @type {T[]} */
    const normalized = [];
    for (const [projectionKey, projectionEntry] of Object.entries(value)) {
        if (typeof projectionEntry === "string") {
            normalized.push(parseString(projectionEntry, [...path, projectionKey]));
            continue;
        }
        if (Array.isArray(projectionEntry)) {
            if (projectionEntry.length < 1) {
                throw frontendModelQueryError(`Invalid ${label} definition for "${projectionKey}": empty array`);
            }
            for (const nestedProjectionEntry of projectionEntry) {
                if (typeof nestedProjectionEntry !== "string") {
                    throw frontendModelQueryError(`Invalid ${label} definition for "${projectionKey}": expected string columns`);
                }
                normalized.push(parseString(nestedProjectionEntry, [...path, projectionKey]));
            }
            continue;
        }
        if (isPlainObject(projectionEntry)) {
            normalized.push(...normalizeColumnProjectionObject(projectionEntry, [...path, projectionKey], parseString, label));
            continue;
        }
        throw frontendModelQueryError(`Invalid ${label} definition for "${projectionKey}": ${typeof projectionEntry}`);
    }
    return normalized;
}
/**
 * Normalize any supported group payload into flat group descriptors.
 * @param {ReturnType<typeof JSON.parse>} group - Group payload.
 * @returns {FrontendModelGroup[]} - Normalized group definitions.
 */
export function normalizeGroup(group) {
    if (!group)
        return [];
    if (typeof group === "string") {
        return [parseGroupString(group)];
    }
    if (columnPathDescriptor(group)) {
        return [{
                column: parseGroupString(group.column).column,
                path: [...group.path]
            }];
    }
    if (isPlainObject(group)) {
        return normalizeColumnProjectionObject(group, [], parseGroupString, "group");
    }
    if (Array.isArray(group)) {
        /**
         * Normalized.
         * @type {FrontendModelGroup[]} */
        const normalized = [];
        for (const groupEntry of group) {
            if (typeof groupEntry === "string") {
                normalized.push(parseGroupString(groupEntry));
                continue;
            }
            if (columnPathDescriptor(groupEntry)) {
                normalized.push({
                    column: parseGroupString(groupEntry.column).column,
                    path: [...groupEntry.path]
                });
                continue;
            }
            if (isPlainObject(groupEntry)) {
                normalized.push(...normalizeColumnProjectionObject(groupEntry, [], parseGroupString, "group"));
                continue;
            }
            throw frontendModelQueryError(`Invalid group entry type: ${typeof groupEntry}`);
        }
        return normalized;
    }
    throw frontendModelQueryError(`Invalid group type: ${typeof group}`);
}
/**
 * Parse a string shorthand into a pluck descriptor.
 * @param {string} pluckValue - Pluck string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelPluck} - Normalized pluck descriptor.
 */
function parsePluckString(pluckValue, path = []) {
    const trimmed = pluckValue.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        throw frontendModelQueryError(`Invalid pluck column: ${pluckValue}`);
    }
    return {
        column: trimmed,
        path: [...path]
    };
}
/**
 * Normalize any supported pluck payload into flat pluck descriptors.
 * @param {ReturnType<typeof JSON.parse>} pluck - Pluck payload.
 * @returns {FrontendModelPluck[]} - Normalized pluck definitions.
 */
export function normalizePluck(pluck) {
    if (!pluck)
        return [];
    if (typeof pluck === "string") {
        return [parsePluckString(pluck)];
    }
    if (columnPathDescriptor(pluck)) {
        return [{
                column: parsePluckString(pluck.column).column,
                path: [...pluck.path]
            }];
    }
    if (isPlainObject(pluck)) {
        return normalizeColumnProjectionObject(pluck, [], parsePluckString, "pluck");
    }
    if (Array.isArray(pluck)) {
        /**
         * Normalized.
         * @type {FrontendModelPluck[]} */
        const normalized = [];
        for (const pluckEntry of pluck) {
            if (typeof pluckEntry === "string") {
                normalized.push(parsePluckString(pluckEntry));
                continue;
            }
            if (columnPathDescriptor(pluckEntry)) {
                normalized.push({
                    column: parsePluckString(pluckEntry.column).column,
                    path: [...pluckEntry.path]
                });
                continue;
            }
            if (isPlainObject(pluckEntry)) {
                normalized.push(...normalizeColumnProjectionObject(pluckEntry, [], parsePluckString, "pluck"));
                continue;
            }
            throw frontendModelQueryError(`Invalid pluck entry type: ${typeof pluckEntry}`);
        }
        return normalized;
    }
    throw frontendModelQueryError(`Invalid pluck type: ${typeof pluck}`);
}
/**
 * Runs frontend model resource attributes.
 * @param {import("./base.js").FrontendModelClass} modelClass - Model class.
 * @returns {Set<string>} - Resource attribute names.
 */
function frontendModelResourceAttributes(modelClass) {
    const resourceConfig = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (modelClass.resourceConfig());
    const attributes = resourceConfig.attributes;
    if (Array.isArray(attributes)) {
        return new Set(attributes);
    }
    if (isPlainObject(attributes)) {
        return new Set(Object.keys(attributes));
    }
    return new Set();
}
/**
 * Runs frontend model pluck target model class.
 * @param {import("./base.js").FrontendModelClass} modelClass - Root model class.
 * @param {string[]} path - Relationship path.
 * @returns {import("./base.js").FrontendModelClass} - Target model class for path.
 */
function frontendModelPluckTargetModelClass(modelClass, path) {
    let targetModelClass = modelClass;
    for (const relationshipName of path) {
        const relationshipDefinitions = targetModelClass.relationshipDefinitions();
        const relationshipModelClasses = targetModelClass.relationshipModelClasses();
        const relationshipDefinition = relationshipDefinitions[relationshipName];
        const relationshipTargetModelClass = resolveFrontendModelClass(relationshipModelClasses[relationshipName]);
        if (!relationshipDefinition) {
            throw new Error(`Unknown pluck relationship "${relationshipName}" for ${targetModelClass.name}`);
        }
        if (!relationshipTargetModelClass) {
            throw new Error(`No relationship model class configured for ${targetModelClass.name}#${relationshipName}`);
        }
        targetModelClass = relationshipTargetModelClass;
    }
    return targetModelClass;
}
/**
 * Runs assert pluck definitions allowed.
 * @param {object} args - Pluck assertion args.
 * @param {import("./base.js").FrontendModelClass} args.modelClass - Root model class.
 * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
 * @returns {FrontendModelPluck[]} - Allowed pluck descriptors.
 */
function assertPluckDefinitionsAllowed({ modelClass, pluck }) {
    return pluck.map((pluckEntry) => {
        const targetModelClass = frontendModelPluckTargetModelClass(modelClass, pluckEntry.path);
        const targetAttributes = frontendModelResourceAttributes(targetModelClass);
        if (!targetAttributes.has(pluckEntry.column)) {
            throw new Error(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`);
        }
        return {
            column: pluckEntry.column,
            path: [...pluckEntry.path]
        };
    });
}
/**
 * Runs serialize find conditions.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - findBy conditions.
 * @returns {string} - Serialized conditions for error messages.
 */
function serializeFindConditions(conditions) {
    try {
        return JSON.stringify(conditions);
    }
    catch {
        return "[unserializable conditions]";
    }
}
/**
 * Runs normalize integer argument.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate integer value.
 * @param {string} argumentName - Argument name for errors.
 * @param {object} options - Integer options.
 * @param {number} options.min - Minimum allowed value.
 * @returns {number} - Normalized integer value.
 */
function normalizeIntegerArgument(value, argumentName, { min }) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`${argumentName} must be an integer number`);
    }
    if (value < min) {
        throw new Error(`${argumentName} must be greater than or equal to ${min}`);
    }
    return value;
}
/**
 * Runs reverse sort direction.
 * @param {"asc" | "desc"} direction - Current sort direction.
 * @returns {"asc" | "desc"} - Reversed direction.
 */
function reverseSortDirection(direction) {
    return direction === "asc" ? "desc" : "asc";
}
/**
 * Query wrapper for frontend model commands.
 * @template {import("./base.js").FrontendModelClass} T
 */
export default class FrontendModelQuery {
    /**
     * Ransack.
     * @type {Record<string, ReturnType<typeof JSON.parse>>[]} */
    _ransack = [];
    /**
     * Searches.
     * @type {FrontendModelSearch[]} */
    _searches = [];
    /**
     * Sort.
     * @type {FrontendModelSort[]} */
    _sort = [];
    /**
     * Group.
     * @type {FrontendModelGroup[]} */
    _group = [];
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {T} args.modelClass - Frontend model class.
     * @param {import("../database/query/index.js").NestedPreloadRecord} [args.preload] - Preload map.
     */
    constructor({ modelClass, preload = {} }) {
        this.modelClass = modelClass;
        this._preload = normalizePreload(preload);
        this._joins = {};
        this._where = {};
        this._searches = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string[]>} */
        this._select = {};
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, string[]>} */
        this._selectsExtra = {};
        this._sort = [];
        this._group = [];
        this._distinct = false;
        this._limit = null;
        this._offset = null;
        this._page = null;
        this._perPage = null;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} */
        this._withCount = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<string | Record<string, ReturnType<typeof JSON.parse>>>} */
        this._queryData = [];
        /**
         * Per-record ability spec. Normalized to a list of
         * `{modelName, actions}` entries — one entry per model that should
         * have ability results attached. The root query's model class
         * name is implicit via `"__root__"` when the caller used the flat
         * array form.
         * @type {Array<{modelName: string, actions: string[]}>}
         */
        this._abilities = [];
    }
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
    abilities(spec) {
        for (const entry of normalizeAbilitiesSpec(spec, this.modelClass)) {
            this._mergeAbilityEntry(entry);
        }
        return this;
    }
    /**
     * Runs merge ability entry.
     * @param {{modelName: string, actions: string[]}} entry - Normalized model ability request to append.
     * @returns {void}
     */
    _mergeAbilityEntry(entry) {
        const existing = this._abilities.find((candidate) => candidate.modelName === entry.modelName);
        if (!existing) {
            this._abilities.push({ actions: [...entry.actions], modelName: entry.modelName });
            return;
        }
        for (const action of entry.actions) {
            if (!existing.actions.includes(action))
                existing.actions.push(action);
        }
    }
    /**
     * Tell the backend index query to attach one or more association
     * counts to each returned record. Parses the same shapes as the
     * backend `ModelClassQuery#withCount`, then ships the normalized
     * entries as part of the `index` command payload.
     * @param {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} spec - Relationships whose counts should be serialized.
     * @returns {this} - This query for chaining.
     */
    withCount(spec) {
        for (const entry of normalizeWithCountFrontend(spec)) {
            this._withCount.push(entry);
        }
        return this;
    }
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
    queryData(spec) {
        if (spec == null)
            return this;
        this._queryData.push(/** @type {ReturnType<typeof JSON.parse>} */ (spec));
        return this;
    }
    /**
     * Runs where.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Root-model where conditions.
     * @returns {this} - Query with merged where conditions.
     */
    where(conditions) {
        this.modelClass.assertFindByConditions(conditions);
        this._where = {
            ...this._where,
            ...conditions
        };
        return this;
    }
    /**
     * Runs scope.
     * @param {import("../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
     * @returns {this} - Scoped query.
     */
    scope(scopeDescriptor) {
        if (!isModelScopeDescriptor(scopeDescriptor)) {
            throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)");
        }
        if (scopeDescriptor.modelClass !== this.modelClass) {
            throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to ${this.modelClass.name} query`);
        }
        const scopedQuery = /** @type {this | void} */ (scopeDescriptor.callback({
            driver: null,
            modelClass: this.modelClass,
            query: this,
            table: null
        }, ...scopeDescriptor.scopeArgs));
        return scopedQuery || this;
    }
    /**
     * Runs ransack.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
     * @returns {this} - Query with Ransack filters and sort applied.
     */
    ransack(params) {
        const { s, ...filterParams } = params;
        const hasFilters = Object.keys(filterParams).length > 0;
        if (hasFilters) {
            normalizeRansackGroup(this.modelClass, filterParams);
            this._ransack.push(filterParams);
        }
        if (typeof s === "string" && s.trim().length > 0) {
            const sorts = parseRansackSort(this.modelClass, s);
            for (const sortDef of sorts) {
                this.sort([[sortDef.attribute, sortDef.direction]]);
            }
        }
        return this;
    }
    /**
     * Runs select with required root attributes.
     * @param {string[]} [requiredAttributes] - Extra required attributes for the root model.
     * @returns {Record<string, string[]>} - Select map with required root attributes merged when root select exists.
     */
    selectWithRequiredRootAttributes(requiredAttributes = []) {
        const rootModelName = this.modelClass.getModelName();
        const selectMap = /** @type {Record<string, string[]>} */ (this._select);
        const existingRootAttributes = selectMap[rootModelName];
        if (!existingRootAttributes) {
            return selectMap;
        }
        const rootPrimaryKey = this.modelClass.primaryKey();
        return {
            ...selectMap,
            [rootModelName]: Array.from(new Set([
                ...(Array.isArray(rootPrimaryKey) ? rootPrimaryKey : [rootPrimaryKey]),
                ...existingRootAttributes,
                ...requiredAttributes
            ]))
        };
    }
    /**
     * Runs preload.
     * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload to merge.
     * @returns {this} - Query with merged preloads.
     */
    preload(preload) {
        mergePreloadRecord(this._preload, normalizePreload(preload));
        return this;
    }
    /**
     * Runs select.
     * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
     * @returns {this} - Query with merged selected attributes.
     */
    select(select) {
        mergeSelectRecord(this._select, normalizeSelect(select, this.modelClass.getModelName()));
        return this;
    }
    /**
     * Like `select(...)`, but keeps the default serialized attributes and loads
     * the given extras in addition (for example attributes declared
     * `selectedByDefault: false`). Keyed by model name, with root-model shorthand.
     * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load, keyed by model name or root-model shorthand.
     * @returns {this} - Query with merged extra selected attributes.
     */
    selectsExtra(select) {
        mergeSelectRecord(this._selectsExtra, normalizeSelect(select, this.modelClass.getModelName()));
        return this;
    }
    /**
     * Runs joins.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} joins - Relationship descriptor joins.
     * @returns {this} - Query with merged joins.
     */
    joins(joins) {
        mergeJoinRecord(this._joins, normalizeJoins(joins));
        return this;
    }
    /**
     * Returns the search result.
     * @param {string[]} path - Relationship path.
     * @param {string} column - Column or attribute name.
     * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
     * @param {ReturnType<typeof JSON.parse>} value - Search value.
     * @returns {this} - Query with appended search.
     */
    search(path, column, operator, value) {
        if (!Array.isArray(path)) {
            throw new Error(`search path must be an array, got: ${typeof path}`);
        }
        for (const pathEntry of path) {
            if (typeof pathEntry !== "string" || pathEntry.length < 1) {
                throw new Error("search path entries must be non-empty strings");
            }
        }
        if (typeof column !== "string" || column.length < 1) {
            throw new Error("search column must be a non-empty string");
        }
        if (typeof operator !== "string" || operator.length < 1) {
            throw new Error("search operator must be a non-empty string");
        }
        const normalizedOperator = normalizeSearchOperator(operator);
        this._searches.push({
            column,
            operator: normalizedOperator,
            path: [...path],
            value
        });
        return this;
    }
    /**
     * Runs sort.
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {this} - Query with appended sort definitions.
     */
    sort(sort) {
        this._sort.push(...normalizeSort(sort));
        return this;
    }
    /**
     * Runs order.
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} order - Order definition(s).
     * @returns {this} - Query with appended sort definitions.
     */
    order(order) {
        return this.sort(order);
    }
    /**
     * Runs group.
     * @param {string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} group - Group definition(s).
     * @returns {this} - Query with appended group definitions.
     */
    group(group) {
        this._group.push(...normalizeGroup(group));
        return this;
    }
    /**
     * Runs distinct.
     * @param {boolean} [value] - Whether to request distinct rows.
     * @returns {this} - Query with distinct flag.
     */
    distinct(value = true) {
        if (typeof value !== "boolean") {
            throw new Error(`distinct must be a boolean, got: ${typeof value}`);
        }
        this._distinct = value;
        return this;
    }
    /**
     * Returns the limit result.
     * @param {number} value - Maximum number of records.
     * @returns {this} - Query with limit.
     */
    limit(value) {
        this._limit = normalizeIntegerArgument(value, "limit", { min: 0 });
        this._page = null;
        return this;
    }
    /**
     * Runs offset.
     * @param {number} value - Number of records to skip.
     * @returns {this} - Query with offset.
     */
    offset(value) {
        this._offset = normalizeIntegerArgument(value, "offset", { min: 0 });
        this._page = null;
        return this;
    }
    /**
     * Runs page.
     * @param {number} pageNumber - 1-based page number.
     * @returns {this} - Query with page applied.
     */
    page(pageNumber) {
        this._page = normalizeIntegerArgument(pageNumber, "page", { min: 1 });
        const pageSize = this._perPage || 30;
        this._limit = pageSize;
        this._offset = (this._page - 1) * pageSize;
        return this;
    }
    /**
     * Runs per page.
     * @param {number} perPage - Page size.
     * @returns {this} - Query with per-page applied.
     */
    perPage(perPage) {
        this._perPage = normalizeIntegerArgument(perPage, "perPage", { min: 1 });
        if (this._page !== null) {
            this._limit = this._perPage;
            this._offset = (this._page - 1) * this._perPage;
        }
        return this;
    }
    /**
     * Runs clone.
     * @returns {FrontendModelQuery<T>} - Cloned query instance.
     */
    clone() {
        const newQuery = /** @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({
            modelClass: this.modelClass,
            preload: normalizePreload(this._preload)
        }));
        newQuery._joins = normalizeJoins(this._joins);
        newQuery._where = { ...this._where };
        newQuery._ransack = this._ransack.map((ransackParams) => ({ ...ransackParams }));
        newQuery._searches = this._searches.map((search) => ({
            column: search.column,
            operator: search.operator,
            path: [...search.path],
            value: search.value
        }));
        newQuery._select = normalizeSelect(this._select);
        newQuery._selectsExtra = normalizeSelect(this._selectsExtra);
        newQuery._sort = this._sort.map((sortEntry) => ({
            column: sortEntry.column,
            direction: sortEntry.direction,
            path: [...sortEntry.path]
        }));
        newQuery._group = this._group.map((groupEntry) => ({
            column: groupEntry.column,
            path: [...groupEntry.path]
        }));
        newQuery._distinct = this._distinct;
        newQuery._limit = this._limit;
        newQuery._offset = this._offset;
        newQuery._page = this._page;
        newQuery._perPage = this._perPage;
        newQuery._withCount = this._withCount.map((entry) => ({
            attributeName: entry.attributeName,
            relationshipName: entry.relationshipName,
            where: entry.where ? { ...entry.where } : undefined
        }));
        newQuery._queryData = this._queryData.map((entry) => (typeof entry === "string" ? entry : { ...entry }));
        newQuery._abilities = this._abilities.map((entry) => ({
            actions: [...entry.actions],
            modelName: entry.modelName
        }));
        return newQuery;
    }
    /**
     * Runs get model class.
     * @returns {T} - Root model class.
     */
    getModelClass() {
        return this.modelClass;
    }
    /**
     * Runs preload payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload preload hash when present.
     */
    preloadPayload() {
        if (Object.keys(this._preload).length === 0)
            return {};
        return { preload: this._preload };
    }
    /**
     * Runs with count payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload withCount array when present.
     */
    withCountPayload() {
        if (this._withCount.length === 0)
            return {};
        return {
            withCount: this._withCount.map((entry) => ({
                attributeName: entry.attributeName,
                relationshipName: entry.relationshipName,
                where: entry.where || undefined
            }))
        };
    }
    /**
     * Runs abilities payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload abilities array when present.
     */
    abilitiesPayload() {
        if (this._abilities.length === 0)
            return {};
        return {
            abilities: this._abilities.map((entry) => ({
                actions: [...entry.actions],
                modelName: entry.modelName
            }))
        };
    }
    /**
     * Runs query data payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload queryData spec when present.
     */
    queryDataPayload() {
        if (this._queryData.length === 0)
            return {};
        // Single accumulated spec goes on the wire verbatim. The backend
        // normalizer accepts string/array/object at each level, so we can
        // ship multiple `.queryData(...)` calls as an array.
        return {
            queryData: this._queryData.length === 1 ? this._queryData[0] : this._queryData
        };
    }
    /**
     * Runs select payload.
     * @param {string[]} [requiredAttributes] - Extra required attributes for root model selection.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload select hash when present.
     */
    selectPayload(requiredAttributes = []) {
        const select = this.selectWithRequiredRootAttributes(requiredAttributes);
        if (Object.keys(select).length === 0)
            return {};
        return { select };
    }
    /**
     * Runs selects extra payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload selectsExtra hash when present.
     */
    selectsExtraPayload() {
        if (Object.keys(this._selectsExtra).length === 0)
            return {};
        return { selectsExtra: this._selectsExtra };
    }
    /**
     * Runs search payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload searches array when present.
     */
    searchPayload() {
        if (this._searches.length === 0)
            return {};
        return {
            searches: this._searches.map((search) => ({
                column: search.column,
                operator: search.operator,
                path: [...search.path],
                value: search.value
            }))
        };
    }
    /**
     * Runs ransack payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload ransack hash when present.
     */
    ransackPayload() {
        if (this._ransack.length === 0)
            return {};
        if (this._ransack.length === 1) {
            return { ransack: this._ransack[0] };
        }
        return {
            ransack: {
                g: this._ransack,
                m: "and"
            }
        };
    }
    /**
     * Runs joins payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload joins hash when present.
     */
    joinsPayload() {
        if (Object.keys(this._joins).length === 0)
            return {};
        return {
            joins: normalizeJoins(this._joins)
        };
    }
    /**
     * Runs sort payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload sort array when present.
     */
    sortPayload() {
        if (this._sort.length === 0)
            return {};
        return {
            sort: this._sort.map((sortEntry) => ({
                column: sortEntry.column,
                direction: sortEntry.direction,
                path: [...sortEntry.path]
            }))
        };
    }
    /**
     * Runs group payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload group array when present.
     */
    groupPayload() {
        if (this._group.length === 0)
            return {};
        return {
            group: this._group.map((groupEntry) => ({
                column: groupEntry.column,
                path: [...groupEntry.path]
            }))
        };
    }
    /**
     * Runs distinct payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload distinct flag when enabled.
     */
    distinctPayload() {
        if (!this._distinct)
            return {};
        return {
            distinct: true
        };
    }
    /**
     * Runs where payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload where hash when present.
     */
    wherePayload() {
        if (Object.keys(this._where).length === 0)
            return {};
        return {
            where: this._where
        };
    }
    /**
     * Runs pagination payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Payload pagination params when present.
     */
    paginationPayload() {
        /**
         * Payload.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const payload = {};
        if (this._limit !== null)
            payload.limit = this._limit;
        if (this._offset !== null)
            payload.offset = this._offset;
        if (this._page !== null)
            payload.page = this._page;
        if (this._perPage !== null)
            payload.perPage = this._perPage;
        return payload;
    }
    /**
     * Runs assert event query supported.
     * @returns {void}
     * @throws {Error} When the query contains list-only options that cannot filter a single lifecycle event.
     */
    assertEventQuerySupported() {
        /**
         * Unsupported options.
         * @type {string[]} */
        const unsupportedOptions = [];
        if (this._sort.length > 0)
            unsupportedOptions.push("sort");
        if (this._group.length > 0)
            unsupportedOptions.push("group");
        if (this._distinct)
            unsupportedOptions.push("distinct");
        if (this._ransack.length > 0)
            unsupportedOptions.push("ransack");
        if (this._limit !== null || this._offset !== null || this._page !== null || this._perPage !== null)
            unsupportedOptions.push("pagination");
        if (unsupportedOptions.length === 0)
            return;
        throw new Error(`Frontend model event queries do not support ${unsupportedOptions.join(", ")}`);
    }
    /**
     * Runs event projection payload.
     * @returns {FrontendModelProjectionPayload} - Projection payload used when serializing lifecycle events.
     */
    eventProjectionPayload() {
        this.assertEventQuerySupported();
        return {
            ...this.preloadPayload(),
            ...this.selectPayload(),
            ...this.selectsExtraPayload(),
            ...this.withCountPayload(),
            ...this.abilitiesPayload(),
            ...this.queryDataPayload()
        };
    }
    /**
     * Runs event filter payload.
     * @returns {FrontendModelEventFilterPayload | null} - Query pieces used to match lifecycle events.
     */
    eventFilterPayload() {
        this.assertEventQuerySupported();
        const payload = {
            ...this.joinsPayload(),
            ...this.searchPayload(),
            ...this.wherePayload()
        };
        return Object.keys(payload).length === 0 ? null : payload;
    }
    /**
     * Returns the eventOptionsPayload result.
     * @returns {FrontendModelEventQueryPayload} - Combined event filter and projection payload.
     */
    eventOptionsPayload() {
        const eventFilterPayload = this.eventFilterPayload();
        return {
            eventFilterKey: eventFilterPayload ? frontendModelEventFilterKey(eventFilterPayload) : null,
            eventFilterPayload,
            projectionPayload: this.eventProjectionPayload()
        };
    }
    /**
     * Runs load.
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    async load() {
        const response = await this.modelClass.executeCommand("index", {
            ...this.preloadPayload(),
            ...this.joinsPayload(),
            ...this.ransackPayload(),
            ...this.searchPayload(),
            ...this.selectPayload(),
            ...this.selectsExtraPayload(),
            ...this.groupPayload(),
            ...this.distinctPayload(),
            ...this.sortPayload(),
            ...this.wherePayload(),
            ...this.withCountPayload(),
            ...this.abilitiesPayload(),
            ...this.queryDataPayload(),
            ...this.paginationPayload()
        });
        if (!response || typeof response !== "object") {
            throw new Error(`Expected object response but got: ${response}`);
        }
        const modelsData = Array.isArray(response.models) ? response.models : [];
        /**
         * Models.
         * @type {InstanceType<T>[]} */
        const models = modelsData.map((model) => this.modelClass.instantiateFromResponse(model));
        // Share a single cohort reference across every sibling so auto-batch-preload
        // can batch lazy relationship access later. Single-record lookups still flow
        // through here (with a cohort of one) and degrade cleanly to per-record load.
        for (const model of models) {
            /** @type {ReturnType<typeof JSON.parse>} */ (model)._loadCohort = models;
        }
        return models;
    }
    /**
     * Runs to array.
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    async toArray() {
        return await this.load();
    }
    /**
     * Runs count.
     * @returns {Promise<number>} - Number of loaded model instances.
     */
    async count() {
        const response = await this.modelClass.executeCommand("index", {
            ...this.joinsPayload(),
            ...this.ransackPayload(),
            ...this.searchPayload(),
            ...this.groupPayload(),
            ...this.distinctPayload(),
            ...this.wherePayload(),
            ...this.paginationPayload(),
            count: true
        });
        if (!response || typeof response !== "object") {
            throw new Error(`Expected object response but got: ${response}`);
        }
        if (!Number.isFinite(response.count)) {
            throw new Error(`Expected numeric count response but got: ${response.count}`);
        }
        return response.count;
    }
    /**
     * Runs first.
     * @returns {Promise<InstanceType<T> | null>} - First model matching query.
     */
    async first() {
        const query = this.clone();
        if (query._sort.length < 1) {
            const primaryKey = this.modelClass.primaryKey();
            query.sort((Array.isArray(primaryKey) ? primaryKey : [primaryKey]).map((column) => [column, "asc"]));
        }
        query.limit(1);
        const models = await query.toArray();
        return models[0] || null;
    }
    /**
     * Runs last.
     * @returns {Promise<InstanceType<T> | null>} - Last model matching query.
     */
    async last() {
        // When pagination is already applied, fetch that scoped window and return its last item.
        if (this._offset !== null || this._page !== null || this._perPage !== null) {
            const models = await this.toArray();
            if (models.length < 1)
                return null;
            return models[models.length - 1];
        }
        const query = this.clone();
        if (query._sort.length < 1) {
            const primaryKey = this.modelClass.primaryKey();
            query.sort((Array.isArray(primaryKey) ? primaryKey : [primaryKey]).map((column) => [column, "desc"]));
        }
        else {
            query._sort = query._sort.map((sortEntry) => ({
                ...sortEntry,
                direction: reverseSortDirection(sortEntry.direction)
            }));
        }
        query.limit(1);
        const models = await query.toArray();
        return models[0] || null;
    }
    /**
     * Runs pluck.
     * @param {...(string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)} columns - Pluck definition(s).
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    async pluck(...columns) {
        if (columns.length < 1) {
            throw new Error("No columns given to pluck");
        }
        const normalizedPluck = normalizePluck(columns.length === 1 ? columns[0] : columns);
        const allowedPluck = assertPluckDefinitionsAllowed({
            modelClass: this.modelClass,
            pluck: normalizedPluck
        });
        const response = await this.modelClass.executeCommand("index", {
            ...this.joinsPayload(),
            ...this.searchPayload(),
            ...this.groupPayload(),
            ...this.distinctPayload(),
            ...this.sortPayload(),
            ...this.wherePayload(),
            ...this.paginationPayload(),
            pluck: allowedPluck
        });
        if (!response || typeof response !== "object") {
            throw new Error(`Expected object response but got: ${response}`);
        }
        if (!Array.isArray(response.values)) {
            return [];
        }
        return response.values;
    }
    /**
     * Runs find.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record id.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    async find(id) {
        const pk = this.modelClass.primaryKey();
        const model = await this.findBy(modelPrimaryKeyConditions(pk, id));
        if (!model) {
            throw new Error(`${this.modelClass.getModelName()} not found with ${pk}=${JSON.stringify(id)}`);
        }
        return model;
    }
    /**
     * Runs find by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T> | null>} - Found model or null.
     */
    async findBy(conditions) {
        const normalizedConditions = this.validatedStructuredConditions(conditions);
        const mergedWhere = {
            ...this._where,
            ...normalizedConditions
        };
        const response = await this.modelClass.executeCommand("index", {
            ...this.preloadPayload(),
            ...this.joinsPayload(),
            ...this.searchPayload(),
            ...this.selectPayload(Object.keys(mergedWhere)),
            ...this.selectsExtraPayload(),
            ...this.groupPayload(),
            ...this.distinctPayload(),
            ...this.sortPayload(),
            ...this.abilitiesPayload(),
            ...this.paginationPayload(),
            where: mergedWhere
        });
        if (!response || typeof response !== "object") {
            throw new Error(`Expected object response but got: ${response}`);
        }
        const models = Array.isArray(response.models) ? response.models : [];
        for (const modelData of models) {
            const model = this.modelClass.instantiateFromResponse(modelData);
            if (this.modelClass.matchesFindByConditions(model, mergedWhere)) {
                return model;
            }
        }
        return null;
    }
    /**
     * Runs find by or fail.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    async findByOrFail(conditions) {
        const model = await this.findBy(conditions);
        if (!model) {
            throw new Error(`${this.modelClass.name} not found for conditions: ${serializeFindConditions(conditions)}`);
        }
        return model;
    }
    /**
     * Runs find or initialize by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
     */
    async findOrInitializeBy(conditions) {
        const normalizedConditions = this.validatedStructuredConditions(conditions);
        const model = await this.findBy(conditions);
        if (model)
            return model;
        const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ ( /** @type {unknown} */(this.modelClass));
        return new ModelClass(/** @type {Record<string, FrontendModelAttributeValue>} */ (normalizedConditions));
    }
    /**
     * Runs find or create by.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Conditions.
     * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save.
     * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
     */
    async findOrCreateBy(conditions, callback) {
        const normalizedConditions = this.validatedStructuredConditions(conditions);
        const model = await this.findBy(conditions);
        if (model)
            return model;
        const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ ( /** @type {unknown} */(this.modelClass));
        const newModel = new ModelClass(/** @type {Record<string, FrontendModelAttributeValue>} */ (normalizedConditions));
        if (callback) {
            await callback(newModel);
        }
        await newModel.save();
        return newModel;
    }
    /**
     * Runs validated structured conditions.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Candidate structured conditions.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Validated conditions.
     */
    validatedStructuredConditions(conditions) {
        this.modelClass.assertFindByConditions(conditions);
        return conditions;
    }
}
/**
 * Runs frontend model event filter key.
 * @param {FrontendModelEventFilterPayload} payload - Event filter payload.
 * @returns {string} - Stable key for event filter matching.
 */
function frontendModelEventFilterKey(payload) {
    return JSON.stringify(payload);
}
/**
 * Runs apply frontend model projection options.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Query receiving projection options.
 * @param {FrontendModelProjectionOptions} options - Projection options.
 * @returns {void}
 */
function applyFrontendModelProjectionOptions(query, options) {
    if (options.select !== undefined)
        query.select(options.select);
    if (options.selectsExtra !== undefined)
        query.selectsExtra(options.selectsExtra);
    if (options.preload !== undefined)
        query.preload(options.preload);
    if (options.withCount !== undefined)
        query.withCount(options.withCount);
    if (options.abilities !== undefined)
        query.abilities(options.abilities);
    if (options.queryData !== undefined)
        query.queryData(options.queryData);
}
/**
 * Runs assert frontend model event query class.
 * @param {import("./base.js").FrontendModelClass} modelClass - Expected frontend model class.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Event query.
 * @returns {void}
 */
function assertFrontendModelEventQueryClass(modelClass, query) {
    if (query.modelClass === modelClass)
        return;
    throw new Error(`Cannot subscribe ${modelClass.name} events with a ${query.modelClass.name} query`);
}
/**
 * Runs assert frontend model event options object.
 * @param {FrontendModelEventOptions} options - Candidate event options.
 * @returns {void}
 */
function assertFrontendModelEventOptionsObject(options) {
    if (options && typeof options === "object" && !Array.isArray(options))
        return;
    throw new Error(`Frontend model event options must be a query or an options object, got: ${options}`);
}
/**
 * Runs cloned frontend model event query.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Event query.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Cloned query used by event subscriptions.
 */
function clonedFrontendModelEventQuery(modelClass, query) {
    assertFrontendModelEventQueryClass(modelClass, query);
    return query.clone();
}
/**
 * Runs frontend model event query from options object.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptionsObject} options - Event options object.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Query used by event subscriptions.
 */
function frontendModelEventQueryFromOptionsObject(modelClass, options) {
    if (options.query !== undefined && !(options.query instanceof FrontendModelQuery)) {
        throw new Error("Frontend model event option query must be a FrontendModelQuery");
    }
    const query = options.query
        ? options.query.clone()
        : new FrontendModelQuery({ modelClass });
    assertFrontendModelEventQueryClass(modelClass, query);
    return query;
}
/**
 * Runs frontend model event query.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptions} [options] - Event query or projection options.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Normalized query used by event subscriptions.
 */
function frontendModelEventQuery(modelClass, options = {}) {
    if (options instanceof FrontendModelQuery)
        return clonedFrontendModelEventQuery(modelClass, options);
    assertFrontendModelEventOptionsObject(options);
    const optionsObject = /** @type {FrontendModelEventOptionsObject} */ (options);
    const query = frontendModelEventQueryFromOptionsObject(modelClass, optionsObject);
    applyFrontendModelProjectionOptions(query, optionsObject);
    return query;
}
/**
 * Runs the frontendModelEventOptionsPayload helper.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptions} [options] - Event query or projection options.
 * @returns {FrontendModelEventOptionsPayload} - Normalized event subscription payload.
 */
export function frontendModelEventOptionsPayload(modelClass, options = {}) {
    const requestContext = options instanceof FrontendModelQuery ? undefined : options.requestContext;
    return {
        ...frontendModelEventQuery(modelClass, options).eventOptionsPayload(),
        requestContext
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUV2RTs7Ozs7OztHQU9HO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7O0dBR0c7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0gsd0VBQXdFO0FBQ3hFLE1BQU0sT0FBTyx1QkFBd0IsU0FBUSxLQUFLO0lBQ2hEOzs7T0FHRztJQUNILFlBQVksT0FBTztRQUNqQixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsSUFBSSxHQUFHLHlCQUF5QixDQUFBO0lBQ3ZDLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHVCQUF1QixDQUFDLE9BQU87SUFDdEMsT0FBTyxJQUFJLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxDQUFBO0FBQzdDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLGdCQUFnQixDQUFDLE9BQU87SUFDdEMsSUFBSSxD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TSxjQUFjLEdBQUcsT0FBTyxZQUFZLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUE7SUFFakcsT0FBTztRQUNMLEdBQUcsdUJBQXVCLENBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFDLG1CQUFtQixFQUFFO1FBQ3JFLGNBQWM7S0FDZixDQUFBO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3Jlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3N9IGZyb20gXCIuL21vZGVsLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCB7bm9ybWFsaXplUmFuc2Fja0dyb3VwLCBwYXJzZVJhbnNhY2tTb3J0fSBmcm9tIFwiLi4vdXRpbHMvcmFuc2Fjay5qc1wiXG5pbXBvcnQge2lzTW9kZWxTY29wZURlc2NyaXB0b3J9IGZyb20gXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9uc30gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsU2VhcmNoIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc2VhcmNoLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB0eXBlLlxuICogQHR5cGVkZWYge251bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgb2JqZWN0fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlfSBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YXR0cmlidXRlTmFtZTogc3RyaW5nLCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn19IEZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnlcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfX0gRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFByb2plY3Rpb25PcHRpb25zXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBbc2VsZWN0XSAtIE1vZGVsLWF3YXJlIGF0dHJpYnV0ZSBzZWxlY3QgbWFwIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gW3NlbGVjdHNFeHRyYV0gLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IFtwcmVsb2FkXSAtIFJlbGF0aW9uc2hpcCBwcmVsb2FkIHRyZWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IHtyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0+fSBbd2l0aENvdW50XSAtIEFzc29jaWF0aW9uIGNvdW50IHNwZWMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbYWJpbGl0aWVzXSAtIEFiaWxpdHkgYWN0aW9ucyB0byBjb21wdXRlIHBlciByZWNvcmQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT4+IHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gW3F1ZXJ5RGF0YV0gLSBCYWNrZW5kIHF1ZXJ5IGRhdGEgbmFtZXMvc3BlYy5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsRXZlbnRSb3V0aW5nT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEV2ZW50Um91dGluZ09wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBbcXVlcnldIC0gUXVlcnkgd2hvc2UgZmlsdGVycyBtYXRjaCBldmVudHMgYW5kIHdob3NlIHByb2plY3Rpb25zIHNoYXBlIGV2ZW50IHJlY29yZHMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IFtyZXF1ZXN0Q29udGV4dF0gLSBSZWdpc3RyYXRpb24tbG9jYWwgcmVtb3RlIHJvdXRpbmcgY29udGV4dC4gSXRzIGNhcHR1cmVkIHZhbHVlIHBhcnRpdGlvbnMgbGlmZWN5Y2xlIHNlcnZlciBzdWJzY3JpcHRpb25zIGFuZCByZXBsYWNlcyB0aGUgdHJhbnNwb3J0LXdpZGUgY29udGV4dCBmb3IgdGhpcyByZWdpc3RyYXRpb24uXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFByb2plY3Rpb25PcHRpb25zICYgRnJvbnRlbmRNb2RlbEV2ZW50Um91dGluZ09wdGlvbnN9IEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3RcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdCB8IEZyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1xuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gW3NlbGVjdF0gLSBOb3JtYWxpemVkIHNlbGVjdCBtYXAuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gW3NlbGVjdHNFeHRyYV0gLSBOb3JtYWxpemVkIGV4dHJhIHNlbGVjdCBtYXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IFtwcmVsb2FkXSAtIE5vcm1hbGl6ZWQgcHJlbG9hZCB0cmVlLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5W119IFt3aXRoQ291bnRdIC0gTm9ybWFsaXplZCBjb3VudCBzcGVjcy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeVtdfSBbYWJpbGl0aWVzXSAtIE5vcm1hbGl6ZWQgYWJpbGl0eSBzcGVjcy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBbcXVlcnlEYXRhXSAtIE5vcm1hbGl6ZWQgcXVlcnlEYXRhIHNwZWMuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZFxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbam9pbnNdIC0gUmVsYXRpb25zaGlwIGpvaW5zIG5lZWRlZCBmb3IgbWF0Y2hpbmcuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gW3NlYXJjaGVzXSAtIFNlYXJjaCBwcmVkaWNhdGVzIG5lZWRlZCBmb3IgbWF0Y2hpbmcuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IFt3aGVyZV0gLSBTdHJ1Y3R1cmVkIHdoZXJlIHByZWRpY2F0ZXMgbmVlZGVkIGZvciBtYXRjaGluZy5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkICYge2tleTogc3RyaW5nfX0gRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEV2ZW50UXVlcnlQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gZXZlbnRGaWx0ZXJLZXkgLSBTdGFibGUgZXZlbnQgZmlsdGVyIGtleSwgb3IgbnVsbCB3aGVuIG5vIGZpbHRlciBpcyBwcmVzZW50LlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkIHwgbnVsbH0gZXZlbnRGaWx0ZXJQYXlsb2FkIC0gTm9ybWFsaXplZCBldmVudCBmaWx0ZXIgcGF5bG9hZCwgb3IgbnVsbCB3aGVuIHVuZmlsdGVyZWQuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gcHJvamVjdGlvblBheWxvYWQgLSBOb3JtYWxpemVkIGV2ZW50IHNlcmlhbGl6YXRpb24gcHJvamVjdGlvbiBwYXlsb2FkLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEV2ZW50UXVlcnlQYXlsb2FkICYge3JlcXVlc3RDb250ZXh0OiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkfX0gRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWRcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsU29ydCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsR3JvdXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxHcm91cFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIGdyb3VwIGJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGx1Y2sgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQbHVja1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHBsdWNrLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqIEVycm9yIHJhaXNlZCB3aGVuIGEgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZGVzY3JpcHRvciBpcyBtYWxmb3JtZWQuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuXG4gICAgdGhpcy5uYW1lID0gXCJGcm9udGVuZE1vZGVsUXVlcnlFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBxdWVyeSBkZXNjcmlwdG9yIGVycm9yLlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yfSAtIFF1ZXJ5IGRlc2NyaXB0b3IgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpIHtcbiAgcmV0dXJuIG5ldyBGcm9udGVuZE1vZGVsUXVlcnlFcnJvcihtZXNzYWdlKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZVByZWxvYWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD4gfCBib29sZWFuIHwgdW5kZWZpbmVkIHwgbnVsbH0gcHJlbG9hZCAtIFByZWxvYWQgc2hvcnRoYW5kLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IC0gTm9ybWFsaXplZCBwcmVsb2FkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUHJlbG9hZChwcmVsb2FkKSB7XG4gIGlmICghcHJlbG9hZCkgcmV0dXJuIHt9XG5cbiAgaWYgKHByZWxvYWQgPT09IHRydWUpIHJldHVybiB7fVxuXG4gIGlmICh0eXBlb2YgcHJlbG9hZCA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7W3ByZWxvYWRdOiB0cnVlfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocHJlbG9hZCkpIHtcbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcmVsb2FkKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIG5vcm1hbGl6ZWRbZW50cnldID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChlbnRyeSkpIHtcbiAgICAgICAgbWVyZ2VQcmVsb2FkUmVjb3JkKG5vcm1hbGl6ZWQsIG5vcm1hbGl6ZVByZWxvYWQoZW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwcmVsb2FkIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChwcmVsb2FkKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHByZWxvYWQgdHlwZTogJHt0eXBlb2YgcHJlbG9hZH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBQcmVsb2FkXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkKSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBQcmVsb2FkID09PSB0cnVlIHx8IHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IGZhbHNlKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gcmVsYXRpb25zaGlwUHJlbG9hZFxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IFwic3RyaW5nXCIgfHwgQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQcmVsb2FkKSB8fCBpc1BsYWluT2JqZWN0KHJlbGF0aW9uc2hpcFByZWxvYWQpKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gbm9ybWFsaXplUHJlbG9hZChyZWxhdGlvbnNoaXBQcmVsb2FkKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwcmVsb2FkIHZhbHVlIGZvciAke3JlbGF0aW9uc2hpcE5hbWV9OiAke3R5cGVvZiByZWxhdGlvbnNoaXBQcmVsb2FkfWApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSB0aGUgc2hvcnRoYW5kIGB3aXRoQ291bnRgIGFyZ3VtZW50IGZyb20gdGhlIGZyb250ZW5kLW1vZGVsXG4gKiBxdWVyeSBBUEkgaW50byB0aGUgc3RyaWN0IGludGVybmFsIGVudHJpZXMgdXNlZCBpbiB0aGUgdHJhbnNwb3J0XG4gKiBwYXlsb2FkLiBTaGFyZXMgdGhlIHNoYXBlIHNlbWFudGljcyB3aXRoIHRoZSBiYWNrZW5kIG5vcm1hbGl6ZXIgaW5cbiAqIGBkYXRhYmFzZS9xdWVyeS93aXRoLWNvdW50LmpzYC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gc3BlYyAtIEFzc29jaWF0aW9uLWNvdW50IHNob3J0aGFuZCB0byBub3JtYWxpemUuXG4gKiBAcmV0dXJucyB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIE5vcm1hbGl6ZWQgYXNzb2NpYXRpb24tY291bnQgcmVxdWVzdHMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdpdGhDb3VudEZyb250ZW5kKHNwZWMpIHtcbiAgaWYgKHNwZWMgPT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFt7YXR0cmlidXRlTmFtZTogYCR7c3BlY31Db3VudGAsIHJlbGF0aW9uc2hpcE5hbWU6IHNwZWN9XVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc3BlYykpIHtcbiAgICByZXR1cm4gc3BlYy5mbGF0TWFwKChpdGVtKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGl0ZW0gIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoQ291bnQgYXJyYXkgZW50cmllcyBtdXN0IGJlIHN0cmluZ3M7IGdvdCAke3R5cGVvZiBpdGVtfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbe2F0dHJpYnV0ZU5hbWU6IGAke2l0ZW19Q291bnRgLCByZWxhdGlvbnNoaXBOYW1lOiBpdGVtfV1cbiAgICB9KVxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHNwZWMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHdpdGhDb3VudCBzcGVjOiAke3R5cGVvZiBzcGVjfWApXG4gIH1cblxuICBjb25zdCBlbnRyaWVzID0gW11cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzcGVjKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgZW50cmllcy5wdXNoKHthdHRyaWJ1dGVOYW1lOiBgJHtrZXl9Q291bnRgLCByZWxhdGlvbnNoaXBOYW1lOiBrZXl9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSBjb250aW51ZVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICBjb25zdCBvcHRpb25zID0gLyoqIEB0eXBlIHt7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovICh2YWx1ZSlcbiAgICAgIGVudHJpZXMucHVzaCh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IGtleSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogb3B0aW9ucy5yZWxhdGlvbnNoaXAgfHwga2V5LFxuICAgICAgICB3aGVyZTogb3B0aW9ucy53aGVyZVxuICAgICAgfSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHdpdGhDb3VudCB2YWx1ZSBmb3IgJHtrZXl9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIGVudHJpZXNcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSBmcm9udGVuZCBgLmFiaWxpdGllcyguLi4pYCBzcGVjIGludG8gYSBmbGF0IGxpc3Qgb2ZcbiAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcy4gQWNjZXB0cyB0aGUgZmxhdCBhY3Rpb25zLWFycmF5XG4gKiBzaG9ydGhhbmQgKGFwcGxpZXMgdG8gdGhlIHF1ZXJ5J3Mgb3duIG1vZGVsIGNsYXNzKSBhbmQgdGhlIGtleWVkXG4gKiBge01vZGVsTmFtZTogW2FjdGlvbiwgLi4uXX1gIGZvcm0gKGFwcGxpZXMgdG8gcmVjb3JkcyBvZiB0aGF0IG1vZGVsXG4gKiBjbGFzcywgdXNlZnVsIGZvciBwcmVsb2FkZWQgY2hpbGRyZW4pLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc3BlYyAtIEFiaWxpdHkgYWN0aW9ucyBncm91cGVkIGJ5IG1vZGVsLCBvciByb290LW1vZGVsIGFjdGlvbiBzaG9ydGhhbmQuXG4gKiBAcGFyYW0ge3tnZXRNb2RlbE5hbWU6ICgpID0+IHN0cmluZ319IHJvb3RNb2RlbENsYXNzIC0gUXVlcnkgcm9vdCB1c2VkIGJ5IHRoZSBmbGF0IGFjdGlvbiBzaG9ydGhhbmQuXG4gKiBAcmV0dXJucyB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQWJpbGl0aWVzU3BlYyhzcGVjLCByb290TW9kZWxDbGFzcykge1xuICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAoQXJyYXkuaXNBcnJheShzcGVjKSkge1xuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIHNwZWMpIHtcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgYWJpbGl0aWVzIGZsYXQtZm9ybSBhY3Rpb25zIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3M7IGdvdCAke3R5cGVvZiBhY3Rpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByb290TW9kZWxOYW1lID0gcm9vdE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImFiaWxpdGllcyBmbGF0LWZvcm0gcmVxdWlyZXMgYSByb290IG1vZGVsIGNsYXNzIHdpdGggZ2V0TW9kZWxOYW1lKClcIilcbiAgICB9XG5cbiAgICByZXR1cm4gW3thY3Rpb25zOiBbLi4uc3BlY10sIG1vZGVsTmFtZTogcm9vdE1vZGVsTmFtZX1dXG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3Qoc3BlYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYWJpbGl0aWVzIHNwZWM6ICR7dHlwZW9mIHNwZWN9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnRyaWVzLlxuICAgKiBAdHlwZSB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAqL1xuICBjb25zdCBlbnRyaWVzID0gW11cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGFjdGlvbnNdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMpKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGFiaWxpdGllc1ske21vZGVsTmFtZX1dIG11c3QgYmUgYW4gYXJyYXkgb2YgYWN0aW9uIG5hbWVzOyBnb3QgJHt0eXBlb2YgYWN0aW9uc31gKVxuICAgIH1cblxuICAgIGNvbnN0IHNhbml0aXplZCA9IGFjdGlvbnMubWFwKChhY3Rpb24pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgYWJpbGl0aWVzWyR7bW9kZWxOYW1lfV0gZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzOyBnb3QgJHt0eXBlb2YgYWN0aW9ufWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpb25cbiAgICB9KVxuXG4gICAgZW50cmllcy5wdXNoKHthY3Rpb25zOiBzYW5pdGl6ZWQsIG1vZGVsTmFtZX0pXG4gIH1cblxuICByZXR1cm4gZW50cmllc1xufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgcHJlbG9hZCByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IHRhcmdldFByZWxvYWQgLSBFeGlzdGluZyBwcmVsb2FkIGRhdGEuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IGluY29taW5nUHJlbG9hZCAtIE5ldyBwcmVsb2FkIGRhdGEuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VQcmVsb2FkUmVjb3JkKHRhcmdldFByZWxvYWQsIGluY29taW5nUHJlbG9hZCkge1xuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCBpbmNvbWluZ1ZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhpbmNvbWluZ1ByZWxvYWQpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFByZWxvYWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmIChpbmNvbWluZ1ZhbHVlID09PSBmYWxzZSkge1xuICAgICAgdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IGZhbHNlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChpbmNvbWluZ1ZhbHVlID09PSB0cnVlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRhcmdldFByZWxvYWRbcmVsYXRpb25zaGlwTmFtZV0gPSB0cnVlXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghaXNQbGFpbk9iamVjdChpbmNvbWluZ1ZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdmFsdWUgZm9yICR7cmVsYXRpb25zaGlwTmFtZX06ICR7dHlwZW9mIGluY29taW5nVmFsdWV9YClcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChleGlzdGluZ1ZhbHVlKSkge1xuICAgICAgbWVyZ2VQcmVsb2FkUmVjb3JkKFxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovIChleGlzdGluZ1ZhbHVlKSxcbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqLyAoaW5jb21pbmdWYWx1ZSlcbiAgICAgIClcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZVByZWxvYWQoaW5jb21pbmdWYWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHNlbGVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNlbGVjdCAtIFNlbGVjdCBwYXlsb2FkLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbcm9vdE1vZGVsTmFtZV0gLSBPcHRpb25hbCByb290IG1vZGVsIG5hbWUgZm9yIHNob3J0aGFuZCBzZWxlY3QgcGF5bG9hZHMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAtIE5vcm1hbGl6ZWQgbW9kZWwtbmFtZSBrZXllZCBzZWxlY3QgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCByb290TW9kZWxOYW1lID0gbnVsbCkge1xuICBpZiAoIXNlbGVjdCkgcmV0dXJuIHt9XG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwic3RyaW5nXCIpIHtcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgc2VsZWN0IHNob3J0aGFuZCB3aXRob3V0IHJvb3QgbW9kZWwgbmFtZVwiKVxuXG4gICAgcmV0dXJuIHtbcm9vdE1vZGVsTmFtZV06IFtzZWxlY3RdfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0KSkge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzZWxlY3Qgc2hvcnRoYW5kIHdpdGhvdXQgcm9vdCBtb2RlbCBuYW1lXCIpXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0KSB7XG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlbGVjdCBhdHRyaWJ1dGUgZm9yICR7cm9vdE1vZGVsTmFtZX06ICR7dHlwZW9mIGF0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdCkpfVxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHNlbGVjdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IHR5cGU6ICR7dHlwZW9mIHNlbGVjdH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgc2VsZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhzZWxlY3QpKSB7XG4gICAgaWYgKHR5cGVvZiBzZWxlY3Rpb24gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWRbbW9kZWxOYW1lXSA9IFtzZWxlY3Rpb25dXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWxlY3Rpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IHZhbHVlIGZvciAke21vZGVsTmFtZX06ICR7dHlwZW9mIHNlbGVjdGlvbn1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3Rpb24pIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IGF0dHJpYnV0ZSBmb3IgJHttb2RlbE5hbWV9OiAke3R5cGVvZiBhdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdGlvbikpXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2Ugc2VsZWN0IHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXRTZWxlY3QgLSBFeGlzdGluZyBzZWxlY3QgcmVjb3JkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IGluY29taW5nU2VsZWN0IC0gSW5jb21pbmcgc2VsZWN0IHJlY29yZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVNlbGVjdFJlY29yZCh0YXJnZXRTZWxlY3QsIGluY29taW5nU2VsZWN0KSB7XG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgaW5jb21pbmdBdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhpbmNvbWluZ1NlbGVjdCkpIHtcbiAgICBjb25zdCBleGlzdGluZ0F0dHJpYnV0ZXMgPSB0YXJnZXRTZWxlY3RbbW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgdGFyZ2V0U2VsZWN0W21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoWy4uLmV4aXN0aW5nQXR0cmlidXRlcywgLi4uaW5jb21pbmdBdHRyaWJ1dGVzXSkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBub3JtYWxpemVTZWFyY2hPcGVyYXRvciBoZWxwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0b3IgLSBSYXcgc2VhcmNoIG9wZXJhdG9yLlxuICogQHJldHVybnMge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gLSBOb3JtYWxpemVkIG9wZXJhdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU2VhcmNoT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuICBjb25zdCBub3JtYWxpemVkT3BlcmF0b3IgPSBvcGVyYXRvckFsaWFzZXNbLyoqIEB0eXBlIHtcIjxcIiB8IFwiPD1cIiB8IFwiPlwiIHwgXCI+PVwifSAqLyAob3BlcmF0b3IpXSB8fCBvcGVyYXRvclxuICBjb25zdCBzdXBwb3J0ZWRPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibGlrZVwiLCBcIm5vdEVxXCIsIFwiZ3RcIiwgXCJndGVxXCIsIFwibHRcIiwgXCJsdGVxXCJdKVxuXG4gIGlmICghc3VwcG9ydGVkT3BlcmF0b3JzLmhhcyhub3JtYWxpemVkT3BlcmF0b3IpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYHNlYXJjaCBvcGVyYXRvciBtdXN0IGJlIG9uZSBvZjogZXEsIGxpa2UsIG5vdEVxLCBndCwgZ3RlcSwgbHQsIGx0ZXEsID4sID49LCA8LCA8PSAoZ290OiAke29wZXJhdG9yfSlgKVxuICB9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwifSAqLyAobm9ybWFsaXplZE9wZXJhdG9yKVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2Ugam9pbiByZWNvcmQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdGFyZ2V0Sm9pbnMgLSBFeGlzdGluZyBqb2luIHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBpbmNvbWluZ0pvaW5zIC0gSW5jb21pbmcgam9pbiByZWNvcmQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VKb2luUmVjb3JkKHRhcmdldEpvaW5zLCBpbmNvbWluZ0pvaW5zKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIGluY29taW5nVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGluY29taW5nSm9pbnMpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldEpvaW5zW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAoaW5jb21pbmdWYWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0YXJnZXRKb2luc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHRydWVcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGluY29taW5nVmFsdWUpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2luIHZhbHVlIGZvciAke3JlbGF0aW9uc2hpcE5hbWV9OiAke3R5cGVvZiBpbmNvbWluZ1ZhbHVlfWApXG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QoZXhpc3RpbmdWYWx1ZSkpIHtcbiAgICAgIG1lcmdlSm9pblJlY29yZChleGlzdGluZ1ZhbHVlLCBpbmNvbWluZ1ZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgdGFyZ2V0Sm9pbnNbcmVsYXRpb25zaGlwTmFtZV0gPSBub3JtYWxpemVKb2lucyhpbmNvbWluZ1ZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0YXJnZXRKb2luc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZUpvaW5zKGluY29taW5nVmFsdWUpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBub3JtYWxpemVKb2lucyBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBqb2lucyAtIEpvaW4gcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTm9ybWFsaXplZCByZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUpvaW5zKGpvaW5zKSB7XG4gIGlmICgham9pbnMpIHJldHVybiB7fVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGpvaW5zKSkge1xuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICAgIGZvciAoY29uc3Qgam9pbkVudHJ5IG9mIGpvaW5zKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3Qoam9pbkVudHJ5KSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2lucyBlbnRyeSB0eXBlOiAke3R5cGVvZiBqb2luRW50cnl9YClcbiAgICAgIH1cblxuICAgICAgbWVyZ2VKb2luUmVjb3JkKG5vcm1hbGl6ZWQsIG5vcm1hbGl6ZUpvaW5zKGpvaW5FbnRyeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChqb2lucykpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2lucyB0eXBlOiAke3R5cGVvZiBqb2luc31gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcEpvaW5dIG9mIE9iamVjdC5lbnRyaWVzKGpvaW5zKSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBKb2luID09PSB0cnVlKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gdHJ1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChyZWxhdGlvbnNoaXBKb2luKSkge1xuICAgICAgbm9ybWFsaXplZFtyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZUpvaW5zKHJlbGF0aW9uc2hpcEpvaW4pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGpvaW4gZGVmaW5pdGlvbiBmb3IgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCI6ICR7dHlwZW9mIHJlbGF0aW9uc2hpcEpvaW59YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc29ydCBkaXJlY3Rpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBkaXJlY3Rpb24gLSBEaXJlY3Rpb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7XCJhc2NcIiB8IFwiZGVzY1wifSAtIE5vcm1hbGl6ZWQgZGlyZWN0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTb3J0RGlyZWN0aW9uKGRpcmVjdGlvbikge1xuICBpZiAodHlwZW9mIGRpcmVjdGlvbiAhPT0gXCJzdHJpbmdcIikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGlyZWN0aW9uIHR5cGU6ICR7dHlwZW9mIGRpcmVjdGlvbn1gKVxuICB9XG5cbiAgY29uc3Qgbm9ybWFsaXplZERpcmVjdGlvbiA9IGRpcmVjdGlvbi50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gIGlmIChub3JtYWxpemVkRGlyZWN0aW9uICE9PSBcImFzY1wiICYmIG5vcm1hbGl6ZWREaXJlY3Rpb24gIT09IFwiZGVzY1wiKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkaXJlY3Rpb246ICR7ZGlyZWN0aW9ufWApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZERpcmVjdGlvblxufVxuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgYSB2YWx1ZSBpcyBhIHR3by1pdGVtIGBbY29sdW1uLCBkaXJlY3Rpb25dYCBzb3J0IHR1cGxlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgW3N0cmluZywgc3RyaW5nXX0gLSBXaGV0aGVyIHZhbHVlIGlzIGEgc29ydCB0dXBsZS5cbiAqL1xuZnVuY3Rpb24gc29ydFR1cGxlKHZhbHVlKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuICBpZiAodmFsdWUubGVuZ3RoICE9PSAyKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZVswXSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG4gIGlmICh0eXBlb2YgdmFsdWVbMV0gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAodmFsdWVbMF0udHJpbSgpLmxlbmd0aCA8IDEpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZhbHVlWzFdLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgcmV0dXJuIGRpcmVjdGlvbiA9PT0gXCJhc2NcIiB8fCBkaXJlY3Rpb24gPT09IFwiZGVzY1wiXG59XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIHZhbHVlIGlzIGEgc3RydWN0dXJlZCBzb3J0IGRlc2NyaXB0b3Igd2l0aCBhIHJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgZGVzY3JpcHRvci5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7Y29sdW1uOiBzdHJpbmcsIGRpcmVjdGlvbjogc3RyaW5nLCBwYXRoOiBzdHJpbmdbXX19IC0gV2hldGhlciB2YWx1ZSBpcyBhbiBleHBsaWNpdCBzb3J0IGRlc2NyaXB0b3Igb2JqZWN0LlxuICovXG5mdW5jdGlvbiBzb3J0RGVzY3JpcHRvcih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKCEoXCJjb2x1bW5cIiBpbiB2YWx1ZSkgfHwgIShcImRpcmVjdGlvblwiIGluIHZhbHVlKSB8fCAhKFwicGF0aFwiIGluIHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmICh0eXBlb2YgdmFsdWUuY29sdW1uICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZS5kaXJlY3Rpb24gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUucGF0aCkpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiB2YWx1ZS5wYXRoLmV2ZXJ5KChwYXRoRW50cnkpID0+IHR5cGVvZiBwYXRoRW50cnkgPT09IFwic3RyaW5nXCIpXG59XG5cbi8qKlxuICogUGFyc2UgYSBzdHJpbmcgc2hvcnRoYW5kIGludG8gYSBzb3J0IGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydFZhbHVlIC0gU29ydCBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbcGF0aF0gLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU29ydH0gLSBOb3JtYWxpemVkIHNvcnQgZGVzY3JpcHRvci5cbiAqL1xuZnVuY3Rpb24gcGFyc2VTb3J0U3RyaW5nKHNvcnRWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzb3J0VmFsdWUudHJpbSgpXG5cbiAgaWYgKHRyaW1tZWQubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwic29ydCB2YWx1ZSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICB9XG5cbiAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi1cIikpIHtcbiAgICBjb25zdCBjb2x1bW4gPSB0cmltbWVkLnNsaWNlKDEpLnRyaW0oKVxuXG4gICAgaWYgKGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb246ICR7c29ydFZhbHVlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbHVtbixcbiAgICAgIGRpcmVjdGlvbjogXCJkZXNjXCIsXG4gICAgICBwYXRoOiBbLi4ucGF0aF1cbiAgICB9XG4gIH1cblxuICBjb25zdCBzb3J0UGFydHMgPSB0cmltbWVkLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pXG5cbiAgaWYgKHNvcnRQYXJ0cy5sZW5ndGggPiAyKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkZWZpbml0aW9uOiAke3NvcnRWYWx1ZX1gKVxuICB9XG5cbiAgY29uc3QgY29sdW1uID0gc29ydFBhcnRzWzBdXG5cbiAgaWYgKGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkZWZpbml0aW9uOiAke3NvcnRWYWx1ZX1gKVxuICB9XG5cbiAgY29uc3QgZGlyZWN0aW9uID0gc29ydFBhcnRzLmxlbmd0aCA9PT0gMlxuICAgID8gbm9ybWFsaXplU29ydERpcmVjdGlvbihzb3J0UGFydHNbMV0pXG4gICAgOiBcImFzY1wiXG5cbiAgcmV0dXJuIHtcbiAgICBjb2x1bW4sXG4gICAgZGlyZWN0aW9uLFxuICAgIHBhdGg6IFsuLi5wYXRoXVxuICB9XG59XG5cbi8qKlxuICogUGFyc2UgYSB0dXBsZSBzaG9ydGhhbmQgaW50byBhIHNvcnQgZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7W3N0cmluZywgc3RyaW5nXX0gc29ydFZhbHVlIC0gU29ydCB0dXBsZS5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0fSAtIE5vcm1hbGl6ZWQgc29ydCBkZXNjcmlwdG9yLlxuICovXG5mdW5jdGlvbiBwYXJzZVNvcnRUdXBsZShzb3J0VmFsdWUsIHBhdGggPSBbXSkge1xuICBjb25zdCBbY29sdW1uVmFsdWUsIGRpcmVjdGlvblZhbHVlXSA9IHNvcnRWYWx1ZVxuICBjb25zdCBjb2x1bW4gPSBjb2x1bW5WYWx1ZS50cmltKClcblxuICBpZiAoY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcInNvcnQgdHVwbGUgY29sdW1uIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvbHVtbixcbiAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oZGlyZWN0aW9uVmFsdWUpLFxuICAgIHBhdGg6IFsuLi5wYXRoXVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgbmVzdGVkIG9iamVjdCBzb3J0IHBheWxvYWQgaW50byBmbGF0IHNvcnQgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gc29ydFZhbHVlIC0gTmVzdGVkIHNvcnQgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0W119IC0gTm9ybWFsaXplZCBzb3J0IGRlc2NyaXB0b3JzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTb3J0T2JqZWN0KHNvcnRWYWx1ZSwgcGF0aCkge1xuICAvKipcbiAgICogTm9ybWFsaXplZCBzb3J0cy5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTb3J0W119ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWRTb3J0cyA9IFtdXG5cbiAgZm9yIChjb25zdCBbc29ydEtleSwgc29ydEVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhzb3J0VmFsdWUpKSB7XG4gICAgaWYgKHR5cGVvZiBzb3J0RW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKHtcbiAgICAgICAgY29sdW1uOiBzb3J0S2V5LFxuICAgICAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oc29ydEVudHJ5KSxcbiAgICAgICAgcGF0aDogWy4uLnBhdGhdXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoc29ydFR1cGxlKHNvcnRFbnRyeSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKHBhcnNlU29ydFR1cGxlKHNvcnRFbnRyeSwgWy4uLnBhdGgsIHNvcnRLZXldKSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc29ydEVudHJ5KSkge1xuICAgICAgaWYgKHNvcnRFbnRyeS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGVmaW5pdGlvbiBmb3IgXCIke3NvcnRLZXl9XCI6IGVtcHR5IGFycmF5YClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBuZXN0ZWRTb3J0RW50cnkgb2Ygc29ydEVudHJ5KSB7XG4gICAgICAgIGlmICghc29ydFR1cGxlKG5lc3RlZFNvcnRFbnRyeSkpIHtcbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb24gZm9yIFwiJHtzb3J0S2V5fVwiOiBleHBlY3RlZCBbY29sdW1uLCBkaXJlY3Rpb25dIHR1cGxlc2ApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkU29ydHMucHVzaChwYXJzZVNvcnRUdXBsZShuZXN0ZWRTb3J0RW50cnksIFsuLi5wYXRoLCBzb3J0S2V5XSkpXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KHNvcnRFbnRyeSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKC4uLm5vcm1hbGl6ZVNvcnRPYmplY3Qoc29ydEVudHJ5LCBbLi4ucGF0aCwgc29ydEtleV0pKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb24gZm9yIFwiJHtzb3J0S2V5fVwiOiAke3R5cGVvZiBzb3J0RW50cnl9YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkU29ydHNcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYW55IHN1cHBvcnRlZCBzb3J0IHBheWxvYWQgaW50byBmbGF0IHNvcnQgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzb3J0IC0gU29ydCBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0W119IC0gTm9ybWFsaXplZCBzb3J0IGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU29ydChzb3J0KSB7XG4gIGlmICghc29ydCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzb3J0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFtwYXJzZVNvcnRTdHJpbmcoc29ydCldXG4gIH1cblxuICBpZiAoc29ydFR1cGxlKHNvcnQpKSB7XG4gICAgcmV0dXJuIFtwYXJzZVNvcnRUdXBsZShzb3J0KV1cbiAgfVxuXG4gIGlmIChzb3J0RGVzY3JpcHRvcihzb3J0KSkge1xuICAgIHJldHVybiBbe1xuICAgICAgY29sdW1uOiBzb3J0LmNvbHVtbi50cmltKCksXG4gICAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oc29ydC5kaXJlY3Rpb24pLFxuICAgICAgcGF0aDogWy4uLnNvcnQucGF0aF1cbiAgICB9XVxuICB9XG5cbiAgaWYgKGlzUGxhaW5PYmplY3Qoc29ydCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplU29ydE9iamVjdChzb3J0LCBbXSlcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHNvcnQpKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICAgIGZvciAoY29uc3Qgc29ydEVudHJ5IG9mIHNvcnQpIHtcbiAgICAgIGlmICh0eXBlb2Ygc29ydEVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVNvcnRTdHJpbmcoc29ydEVudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHNvcnRUdXBsZShzb3J0RW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVNvcnRUdXBsZShzb3J0RW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoc29ydERlc2NyaXB0b3Ioc29ydEVudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goe1xuICAgICAgICAgIGNvbHVtbjogc29ydEVudHJ5LmNvbHVtbi50cmltKCksXG4gICAgICAgICAgZGlyZWN0aW9uOiBub3JtYWxpemVTb3J0RGlyZWN0aW9uKHNvcnRFbnRyeS5kaXJlY3Rpb24pLFxuICAgICAgICAgIHBhdGg6IFsuLi5zb3J0RW50cnkucGF0aF1cbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3Qoc29ydEVudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goLi4ubm9ybWFsaXplU29ydE9iamVjdChzb3J0RW50cnksIFtdKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBlbnRyeSB0eXBlOiAke3R5cGVvZiBzb3J0RW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCB0eXBlOiAke3R5cGVvZiBzb3J0fWApXG59XG5cbi8qKlxuICogUGFyc2UgYSBzdHJpbmcgc2hvcnRoYW5kIGludG8gYSBncm91cCBkZXNjcmlwdG9yLlxuICogQHBhcmFtIHtzdHJpbmd9IGdyb3VwVmFsdWUgLSBHcm91cCBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbcGF0aF0gLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsR3JvdXB9IC0gTm9ybWFsaXplZCBncm91cCBkZXNjcmlwdG9yLlxuICovXG5mdW5jdGlvbiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwVmFsdWUsIHBhdGggPSBbXSkge1xuICBjb25zdCB0cmltbWVkID0gZ3JvdXBWYWx1ZS50cmltKClcblxuICBpZiAoIS9eW2EtekEtWl9dW2EtekEtWjAtOV9dKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBncm91cCBjb2x1bW46ICR7Z3JvdXBWYWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjb2x1bW46IHRyaW1tZWQsXG4gICAgcGF0aDogWy4uLnBhdGhdXG4gIH1cbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgdmFsdWUgaXMgYSBzdHJ1Y3R1cmVkIGNvbHVtbi9wYXRoIGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBkZXNjcmlwdG9yLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHtjb2x1bW46IHN0cmluZywgcGF0aDogc3RyaW5nW119fSAtIFdoZXRoZXIgY2FuZGlkYXRlIGlzIGFuIGV4cGxpY2l0IGNvbHVtbiBkZXNjcmlwdG9yIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gY29sdW1uUGF0aERlc2NyaXB0b3IodmFsdWUpIHtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmICghKFwiY29sdW1uXCIgaW4gdmFsdWUpIHx8ICEoXCJwYXRoXCIgaW4gdmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb2x1bW4gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUucGF0aCkpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiB2YWx1ZS5wYXRoLmV2ZXJ5KChwYXRoRW50cnkpID0+IHR5cGVvZiBwYXRoRW50cnkgPT09IFwic3RyaW5nXCIpXG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgbmVzdGVkIG9iamVjdCBjb2x1bW4gcHJvamVjdGlvbiBwYXlsb2FkIGludG8gZmxhdCBkZXNjcmlwdG9ycy5cbiAqIEB0ZW1wbGF0ZSB7e2NvbHVtbjogc3RyaW5nLCBwYXRoOiBzdHJpbmdbXX19IFRcbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIE5lc3RlZCBwcm9qZWN0aW9uIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEBwYXJhbSB7KGNvbHVtblZhbHVlOiBzdHJpbmcsIHBhdGg/OiBzdHJpbmdbXSkgPT4gVH0gcGFyc2VTdHJpbmcgLSBTdHJpbmcgcHJvamVjdGlvbiBwYXJzZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBQcm9qZWN0aW9uIGxhYmVsIGZvciBlcnJvcnMuXG4gKiBAcmV0dXJucyB7VFtdfSAtIE5vcm1hbGl6ZWQgcHJvamVjdGlvbiBkZXNjcmlwdG9ycy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdCh2YWx1ZSwgcGF0aCwgcGFyc2VTdHJpbmcsIGxhYmVsKSB7XG4gIC8qKlxuICAgKiBOb3JtYWxpemVkLlxuICAgKiBAdHlwZSB7VFtdfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICBmb3IgKGNvbnN0IFtwcm9qZWN0aW9uS2V5LCBwcm9qZWN0aW9uRW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgIGlmICh0eXBlb2YgcHJvamVjdGlvbkVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBub3JtYWxpemVkLnB1c2gocGFyc2VTdHJpbmcocHJvamVjdGlvbkVudHJ5LCBbLi4ucGF0aCwgcHJvamVjdGlvbktleV0pKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcm9qZWN0aW9uRW50cnkpKSB7XG4gICAgICBpZiAocHJvamVjdGlvbkVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtsYWJlbH0gZGVmaW5pdGlvbiBmb3IgXCIke3Byb2plY3Rpb25LZXl9XCI6IGVtcHR5IGFycmF5YClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBuZXN0ZWRQcm9qZWN0aW9uRW50cnkgb2YgcHJvamVjdGlvbkVudHJ5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgbmVzdGVkUHJvamVjdGlvbkVudHJ5ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtsYWJlbH0gZGVmaW5pdGlvbiBmb3IgXCIke3Byb2plY3Rpb25LZXl9XCI6IGV4cGVjdGVkIHN0cmluZyBjb2x1bW5zYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVN0cmluZyhuZXN0ZWRQcm9qZWN0aW9uRW50cnksIFsuLi5wYXRoLCBwcm9qZWN0aW9uS2V5XSkpXG4gICAgICB9XG5cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QocHJvamVjdGlvbkVudHJ5KSkge1xuICAgICAgbm9ybWFsaXplZC5wdXNoKC4uLm5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QocHJvamVjdGlvbkVudHJ5LCBbLi4ucGF0aCwgcHJvamVjdGlvbktleV0sIHBhcnNlU3RyaW5nLCBsYWJlbCkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkICR7bGFiZWx9IGRlZmluaXRpb24gZm9yIFwiJHtwcm9qZWN0aW9uS2V5fVwiOiAke3R5cGVvZiBwcm9qZWN0aW9uRW50cnl9YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogTm9ybWFsaXplIGFueSBzdXBwb3J0ZWQgZ3JvdXAgcGF5bG9hZCBpbnRvIGZsYXQgZ3JvdXAgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBncm91cCAtIEdyb3VwIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEdyb3VwW119IC0gTm9ybWFsaXplZCBncm91cCBkZWZpbml0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwKGdyb3VwKSB7XG4gIGlmICghZ3JvdXApIHJldHVybiBbXVxuXG4gIGlmICh0eXBlb2YgZ3JvdXAgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW3BhcnNlR3JvdXBTdHJpbmcoZ3JvdXApXVxuICB9XG5cbiAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKGdyb3VwKSkge1xuICAgIHJldHVybiBbe1xuICAgICAgY29sdW1uOiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwLmNvbHVtbikuY29sdW1uLFxuICAgICAgcGF0aDogWy4uLmdyb3VwLnBhdGhdXG4gICAgfV1cbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KGdyb3VwKSkge1xuICAgIHJldHVybiBub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KGdyb3VwLCBbXSwgcGFyc2VHcm91cFN0cmluZywgXCJncm91cFwiKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoZ3JvdXApKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEdyb3VwW119ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwRW50cnkgb2YgZ3JvdXApIHtcbiAgICAgIGlmICh0eXBlb2YgZ3JvdXBFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBub3JtYWxpemVkLnB1c2gocGFyc2VHcm91cFN0cmluZyhncm91cEVudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKGdyb3VwRW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICAgICAgY29sdW1uOiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwRW50cnkuY29sdW1uKS5jb2x1bW4sXG4gICAgICAgICAgcGF0aDogWy4uLmdyb3VwRW50cnkucGF0aF1cbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QoZ3JvdXBFbnRyeSkpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKC4uLm5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QoZ3JvdXBFbnRyeSwgW10sIHBhcnNlR3JvdXBTdHJpbmcsIFwiZ3JvdXBcIikpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGdyb3VwIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGdyb3VwRW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgZ3JvdXAgdHlwZTogJHt0eXBlb2YgZ3JvdXB9YClcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHN0cmluZyBzaG9ydGhhbmQgaW50byBhIHBsdWNrIGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGx1Y2tWYWx1ZSAtIFBsdWNrIHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja30gLSBOb3JtYWxpemVkIHBsdWNrIGRlc2NyaXB0b3IuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUGx1Y2tTdHJpbmcocGx1Y2tWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBwbHVja1ZhbHVlLnRyaW0oKVxuXG4gIGlmICghL15bYS16QS1aX11bYS16QS1aMC05X10qJC8udGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHBsdWNrIGNvbHVtbjogJHtwbHVja1ZhbHVlfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvbHVtbjogdHJpbW1lZCxcbiAgICBwYXRoOiBbLi4ucGF0aF1cbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhbnkgc3VwcG9ydGVkIHBsdWNrIHBheWxvYWQgaW50byBmbGF0IHBsdWNrIGRlc2NyaXB0b3JzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGx1Y2sgLSBQbHVjayBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIE5vcm1hbGl6ZWQgcGx1Y2sgZGVmaW5pdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQbHVjayhwbHVjaykge1xuICBpZiAoIXBsdWNrKSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHBsdWNrID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFtwYXJzZVBsdWNrU3RyaW5nKHBsdWNrKV1cbiAgfVxuXG4gIGlmIChjb2x1bW5QYXRoRGVzY3JpcHRvcihwbHVjaykpIHtcbiAgICByZXR1cm4gW3tcbiAgICAgIGNvbHVtbjogcGFyc2VQbHVja1N0cmluZyhwbHVjay5jb2x1bW4pLmNvbHVtbixcbiAgICAgIHBhdGg6IFsuLi5wbHVjay5wYXRoXVxuICAgIH1dXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdChwbHVjaykpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdChwbHVjaywgW10sIHBhcnNlUGx1Y2tTdHJpbmcsIFwicGx1Y2tcIilcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHBsdWNrKSkge1xuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZWQuXG4gICAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBwbHVja0VudHJ5IG9mIHBsdWNrKSB7XG4gICAgICBpZiAodHlwZW9mIHBsdWNrRW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHBhcnNlUGx1Y2tTdHJpbmcocGx1Y2tFbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjb2x1bW5QYXRoRGVzY3JpcHRvcihwbHVja0VudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goe1xuICAgICAgICAgIGNvbHVtbjogcGFyc2VQbHVja1N0cmluZyhwbHVja0VudHJ5LmNvbHVtbikuY29sdW1uLFxuICAgICAgICAgIHBhdGg6IFsuLi5wbHVja0VudHJ5LnBhdGhdXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KHBsdWNrRW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCguLi5ub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KHBsdWNrRW50cnksIFtdLCBwYXJzZVBsdWNrU3RyaW5nLCBcInBsdWNrXCIpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwbHVjayBlbnRyeSB0eXBlOiAke3R5cGVvZiBwbHVja0VudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHBsdWNrIHR5cGU6ICR7dHlwZW9mIHBsdWNrfWApXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gUmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVzKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgcmVzb3VyY2VDb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKSlcbiAgY29uc3QgYXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLmF0dHJpYnV0ZXNcblxuICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgIHJldHVybiBuZXcgU2V0KGF0dHJpYnV0ZXMpXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzKSkge1xuICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZXQoKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGx1Y2sgdGFyZ2V0IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSAtIFRhcmdldCBtb2RlbCBjbGFzcyBmb3IgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFBsdWNrVGFyZ2V0TW9kZWxDbGFzcyhtb2RlbENsYXNzLCBwYXRoKSB7XG4gIGxldCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMgPSB0YXJnZXRNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcbiAgICBjb25zdCByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMgPSB0YXJnZXRNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IHJlbGF0aW9uc2hpcERlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyA9IHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcGx1Y2sgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzXG4gIH1cblxuICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzc1xufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IHBsdWNrIGRlZmluaXRpb25zIGFsbG93ZWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBsdWNrIGFzc2VydGlvbiBhcmdzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUGx1Y2tbXX0gYXJncy5wbHVjayAtIFBsdWNrIGRlc2NyaXB0b3JzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIEFsbG93ZWQgcGx1Y2sgZGVzY3JpcHRvcnMuXG4gKi9cbmZ1bmN0aW9uIGFzc2VydFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHttb2RlbENsYXNzLCBwbHVja30pIHtcbiAgcmV0dXJuIHBsdWNrLm1hcCgocGx1Y2tFbnRyeSkgPT4ge1xuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsUGx1Y2tUYXJnZXRNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIHBsdWNrRW50cnkucGF0aClcbiAgICBjb25zdCB0YXJnZXRBdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCF0YXJnZXRBdHRyaWJ1dGVzLmhhcyhwbHVja0VudHJ5LmNvbHVtbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwbHVjayBjb2x1bW4gXCIke3BsdWNrRW50cnkuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb2x1bW46IHBsdWNrRW50cnkuY29sdW1uLFxuICAgICAgcGF0aDogWy4uLnBsdWNrRW50cnkucGF0aF1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzZXJpYWxpemUgZmluZCBjb25kaXRpb25zLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2VyaWFsaXplZCBjb25kaXRpb25zIGZvciBlcnJvciBtZXNzYWdlcy5cbiAqL1xuZnVuY3Rpb24gc2VyaWFsaXplRmluZENvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb25kaXRpb25zKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gXCJbdW5zZXJpYWxpemFibGUgY29uZGl0aW9uc11cIlxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgaW50ZWdlciBhcmd1bWVudC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGludGVnZXIgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJndW1lbnROYW1lIC0gQXJndW1lbnQgbmFtZSBmb3IgZXJyb3JzLlxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBJbnRlZ2VyIG9wdGlvbnMuXG4gKiBAcGFyYW0ge251bWJlcn0gb3B0aW9ucy5taW4gLSBNaW5pbXVtIGFsbG93ZWQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5vcm1hbGl6ZWQgaW50ZWdlciB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplSW50ZWdlckFyZ3VtZW50KHZhbHVlLCBhcmd1bWVudE5hbWUsIHttaW59KSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2FyZ3VtZW50TmFtZX0gbXVzdCBiZSBhbiBpbnRlZ2VyIG51bWJlcmApXG4gIH1cblxuICBpZiAodmFsdWUgPCBtaW4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7YXJndW1lbnROYW1lfSBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byAke21pbn1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUnVucyByZXZlcnNlIHNvcnQgZGlyZWN0aW9uLlxuICogQHBhcmFtIHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIEN1cnJlbnQgc29ydCBkaXJlY3Rpb24uXG4gKiBAcmV0dXJucyB7XCJhc2NcIiB8IFwiZGVzY1wifSAtIFJldmVyc2VkIGRpcmVjdGlvbi5cbiAqL1xuZnVuY3Rpb24gcmV2ZXJzZVNvcnREaXJlY3Rpb24oZGlyZWN0aW9uKSB7XG4gIHJldHVybiBkaXJlY3Rpb24gPT09IFwiYXNjXCIgPyBcImRlc2NcIiA6IFwiYXNjXCJcbn1cblxuLyoqXG4gKiBRdWVyeSB3cmFwcGVyIGZvciBmcm9udGVuZCBtb2RlbCBjb21tYW5kcy5cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gVFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsUXVlcnkge1xuICAvKipcbiAgICogUmFuc2Fjay5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdfSAqL1xuICBfcmFuc2FjayA9IFtdXG4gIC8qKlxuICAgKiBTZWFyY2hlcy5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi9cbiAgX3NlYXJjaGVzID0gW11cbiAgLyoqXG4gICAqIFNvcnQuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsU29ydFtdfSAqL1xuICBfc29ydCA9IFtdXG4gIC8qKlxuICAgKiBHcm91cC5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxHcm91cFtdfSAqL1xuICBfZ3JvdXAgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbnN0cnVjdG9yIGFyZ3MuXG4gICAqIEBwYXJhbSB7VH0gYXJncy5tb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gW2FyZ3MucHJlbG9hZF0gLSBQcmVsb2FkIG1hcC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbENsYXNzLCBwcmVsb2FkID0ge319KSB7XG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkKHByZWxvYWQpXG4gICAgdGhpcy5fam9pbnMgPSB7fVxuICAgIHRoaXMuX3doZXJlID0ge31cbiAgICB0aGlzLl9zZWFyY2hlcyA9IFtdXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gICAgdGhpcy5fc2VsZWN0ID0ge31cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgICB0aGlzLl9zZWxlY3RzRXh0cmEgPSB7fVxuICAgIHRoaXMuX3NvcnQgPSBbXVxuICAgIHRoaXMuX2dyb3VwID0gW11cbiAgICB0aGlzLl9kaXN0aW5jdCA9IGZhbHNlXG4gICAgdGhpcy5fbGltaXQgPSBudWxsXG4gICAgdGhpcy5fb2Zmc2V0ID0gbnVsbFxuICAgIHRoaXMuX3BhZ2UgPSBudWxsXG4gICAgdGhpcy5fcGVyUGFnZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICB0aGlzLl93aXRoQ291bnQgPSBbXVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9xdWVyeURhdGEgPSBbXVxuICAgIC8qKlxuICAgICAqIFBlci1yZWNvcmQgYWJpbGl0eSBzcGVjLiBOb3JtYWxpemVkIHRvIGEgbGlzdCBvZlxuICAgICAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcyDigJQgb25lIGVudHJ5IHBlciBtb2RlbCB0aGF0IHNob3VsZFxuICAgICAqIGhhdmUgYWJpbGl0eSByZXN1bHRzIGF0dGFjaGVkLiBUaGUgcm9vdCBxdWVyeSdzIG1vZGVsIGNsYXNzXG4gICAgICogbmFtZSBpcyBpbXBsaWNpdCB2aWEgYFwiX19yb290X19cImAgd2hlbiB0aGUgY2FsbGVyIHVzZWQgdGhlIGZsYXRcbiAgICAgKiBhcnJheSBmb3JtLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59XG4gICAgICovXG4gICAgdGhpcy5fYWJpbGl0aWVzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBiYWNrZW5kIHRvIGV2YWx1YXRlIG9uZSBvciBtb3JlIGFiaWxpdHkgYWN0aW9ucyBhZ2FpbnN0XG4gICAqIGVhY2ggcmV0dXJuZWQgcmVjb3JkIChhbmQgaXRzIHByZWxvYWRlZCByZWxhdGlvbnMsIHdoZW4ga2V5ZWQgYnlcbiAgICogbW9kZWwgbmFtZSkgYW5kIHNoaXAgdGhlIHJlc3VsdHMgYmFjayBzbyB0aGUgZnJvbnRlbmQgY2FuIHJlYWRcbiAgICogdGhlbSB2aWEgYHJlY29yZC5jYW4oYWN0aW9uKWAuXG4gICAqXG4gICAqIEZsYXQgZm9ybSDigJQgYXBwbGllcyB0byB0aGUgcXVlcnkncyBvd24gbW9kZWwgY2xhc3M6XG4gICAqICAgYGBgXG4gICAqICAgY29uc3QgdGltZWxvZ3MgPSBhd2FpdCBUaW1lbG9nLndoZXJlKHt0YXNrSWR9KVxuICAgKiAgICAgLmFiaWxpdGllcyhbXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdKVxuICAgKiAgICAgLnRvQXJyYXkoKVxuICAgKiAgIHRpbWVsb2dzWzBdLmNhbihcInVwZGF0ZVwiKSAvLyDihpIgYm9vbGVhblxuICAgKiAgIGBgYFxuICAgKlxuICAgKiBLZXllZCBmb3JtIOKAlCB0YXJnZXRzIHJlY29yZHMgYnkgbW9kZWwgbmFtZSwgdXNlZnVsIGZvciBwcmVsb2FkZWRcbiAgICogY2hpbGRyZW46XG4gICAqICAgYGBgXG4gICAqICAgY29uc3QgcHJvamVjdCA9IGF3YWl0IFByb2plY3RcbiAgICogICAgIC5wcmVsb2FkKFwidGltZWxvZ3NcIilcbiAgICogICAgIC5hYmlsaXRpZXMoe1RpbWVsb2c6IFtcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl19KVxuICAgKiAgICAgLmZpcnN0KClcbiAgICogICBwcm9qZWN0LnRpbWVsb2dzKCkubG9hZGVkKClbMF0uY2FuKFwidXBkYXRlXCIpIC8vIOKGkiBib29sZWFuXG4gICAqICAgYGBgXG4gICAqXG4gICAqIEtleXMgaW4gdGhlIGtleWVkIGZvcm0gYXJlIHRoZSBiYWNrZW5kIG1vZGVsIG5hbWVzIChhcyByZXR1cm5lZCBieVxuICAgKiBgTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKWAgLyB0aGUgYG1vZGVsTmFtZWAgZmllbGQgb2YgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGNvbmZpZykuIFZhbHVlcyBhcmUgdGhlIGFiaWxpdHktYWN0aW9uXG4gICAqIHN0cmluZ3Mg4oCUIHR5cGljYWxseSBgXCJ1cGRhdGVcImAgLyBgXCJkZXN0cm95XCJgIC8gYFwiY3JlYXRlXCJgIC9cbiAgICogYFwicmVhZFwiYCwgYnV0IGFueSBjdXN0b20gYWN0aW9uIHJlZ2lzdGVyZWQgb24gdGhlIHJlc291cmNlJ3NcbiAgICogYXV0aG9yaXphdGlvbiBhYmlsaXR5IGlzIGFjY2VwdGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzcGVjIC0gQWJpbGl0eSBhY3Rpb25zIHRvIHJlcXVlc3QgZm9yIHJvb3Qgb3IgbmFtZWQgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5IGZvciBjaGFpbmluZy5cbiAgICovXG4gIGFiaWxpdGllcyhzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVBYmlsaXRpZXNTcGVjKHNwZWMsIHRoaXMubW9kZWxDbGFzcykpIHtcbiAgICAgIHRoaXMuX21lcmdlQWJpbGl0eUVudHJ5KGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZXJnZSBhYmlsaXR5IGVudHJ5LlxuICAgKiBAcGFyYW0ge3ttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119fSBlbnRyeSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0IHRvIGFwcGVuZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbWVyZ2VBYmlsaXR5RW50cnkoZW50cnkpIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX2FiaWxpdGllcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5tb2RlbE5hbWUgPT09IGVudHJ5Lm1vZGVsTmFtZSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX2FiaWxpdGllcy5wdXNoKHthY3Rpb25zOiBbLi4uZW50cnkuYWN0aW9uc10sIG1vZGVsTmFtZTogZW50cnkubW9kZWxOYW1lfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIGVudHJ5LmFjdGlvbnMpIHtcbiAgICAgIGlmICghZXhpc3RpbmcuYWN0aW9ucy5pbmNsdWRlcyhhY3Rpb24pKSBleGlzdGluZy5hY3Rpb25zLnB1c2goYWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBiYWNrZW5kIGluZGV4IHF1ZXJ5IHRvIGF0dGFjaCBvbmUgb3IgbW9yZSBhc3NvY2lhdGlvblxuICAgKiBjb3VudHMgdG8gZWFjaCByZXR1cm5lZCByZWNvcmQuIFBhcnNlcyB0aGUgc2FtZSBzaGFwZXMgYXMgdGhlXG4gICAqIGJhY2tlbmQgYE1vZGVsQ2xhc3NRdWVyeSN3aXRoQ291bnRgLCB0aGVuIHNoaXBzIHRoZSBub3JtYWxpemVkXG4gICAqIGVudHJpZXMgYXMgcGFydCBvZiB0aGUgYGluZGV4YCBjb21tYW5kIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gc3BlYyAtIFJlbGF0aW9uc2hpcHMgd2hvc2UgY291bnRzIHNob3VsZCBiZSBzZXJpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5IGZvciBjaGFpbmluZy5cbiAgICovXG4gIHdpdGhDb3VudChzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVXaXRoQ291bnRGcm9udGVuZChzcGVjKSkge1xuICAgICAgdGhpcy5fd2l0aENvdW50LnB1c2goZW50cnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0IG9uZSBvciBtb3JlIGJhY2tlbmQgcXVlcnlEYXRhIGVudHJpZXMgZm9yIGVhY2ggcmV0dXJuZWRcbiAgICogcmVjb3JkLiBUaGUgc3BlYyBpcyBhIG5hbWUgb3IgbmVzdGVkLXJlY29yZCBzaGFwZSBtYXRjaGluZyB0aGVcbiAgICogYE1vZGVsLnF1ZXJ5RGF0YShuYW1lLCBmbilgIHJlZ2lzdHJhdGlvbnMgb24gdGhlIGJhY2tlbmQg4oCUIHRoZVxuICAgKiBmcm9udGVuZCBzaGlwcyBvbmx5IHRoZXNlIG5hbWVzOyB0aGUgU1FMIGZyYWdtZW50cyBzdGF5IHNlcnZlci1cbiAgICogc2lkZS4gQWxsIHJlc3VsdGluZyBhbGlhc2VzIGFyZSBhdHRhY2hlZCB0byB0aGUgcm9vdCByZWNvcmQgYW5kXG4gICAqIHJlYWQgYmFjayB3aXRoIGByZWNvcmQucXVlcnlEYXRhKGFsaWFzTmFtZSlgLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHNwZWMgLSBCYWNrZW5kIHF1ZXJ5LWRhdGEgbmFtZXMgYW5kIGFyZ3VtZW50cyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnkgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgcXVlcnlEYXRhKHNwZWMpIHtcbiAgICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gdGhpc1xuXG4gICAgdGhpcy5fcXVlcnlEYXRhLnB1c2goLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHNwZWMpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBtZXJnZWQgd2hlcmUgY29uZGl0aW9ucy5cbiAgICovXG4gIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3MuYXNzZXJ0RmluZEJ5Q29uZGl0aW9ucyhjb25kaXRpb25zKVxuXG4gICAgdGhpcy5fd2hlcmUgPSB7XG4gICAgICAuLi50aGlzLl93aGVyZSxcbiAgICAgIC4uLmNvbmRpdGlvbnNcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NvcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IHNjb3BlRGVzY3JpcHRvciAtIFNjb3BlIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHNjb3BlKHNjb3BlRGVzY3JpcHRvcikge1xuICAgIGlmICghaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihzY29wZURlc2NyaXB0b3IpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZSgpIGV4cGVjdHMgYSBkZXNjcmlwdG9yIHJldHVybmVkIGJ5IGRlZmluZVNjb3BlKC4uLikuc2NvcGUoLi4uKVwiKVxuICAgIH1cblxuICAgIGlmIChzY29wZURlc2NyaXB0b3IubW9kZWxDbGFzcyAhPT0gdGhpcy5tb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhcHBseSAke3Njb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzLm5hbWV9IHNjb3BlIHRvICR7dGhpcy5tb2RlbENsYXNzLm5hbWV9IHF1ZXJ5YClcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7dGhpcyB8IHZvaWR9ICovIChzY29wZURlc2NyaXB0b3IuY2FsbGJhY2soe1xuICAgICAgZHJpdmVyOiBudWxsLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgcXVlcnk6IHRoaXMsXG4gICAgICB0YWJsZTogbnVsbFxuICAgIH0sIC4uLnNjb3BlRGVzY3JpcHRvci5zY29wZUFyZ3MpKVxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5IHx8IHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLiBTdXBwb3J0cyBgc2Aga2V5IGZvciBzb3J0aW5nIChlLmcuLCBge3M6IFwibmFtZSBhc2NcIn1gKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYW5kIHNvcnQgYXBwbGllZC5cbiAgICovXG4gIHJhbnNhY2socGFyYW1zKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSBwYXJhbXNcbiAgICBjb25zdCBoYXNGaWx0ZXJzID0gT2JqZWN0LmtleXMoZmlsdGVyUGFyYW1zKS5sZW5ndGggPiAwXG5cbiAgICBpZiAoaGFzRmlsdGVycykge1xuICAgICAgbm9ybWFsaXplUmFuc2Fja0dyb3VwKHRoaXMubW9kZWxDbGFzcywgZmlsdGVyUGFyYW1zKVxuICAgICAgdGhpcy5fcmFuc2Fjay5wdXNoKGZpbHRlclBhcmFtcylcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHMgPT09IFwic3RyaW5nXCIgJiYgcy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc29ydHMgPSBwYXJzZVJhbnNhY2tTb3J0KHRoaXMubW9kZWxDbGFzcywgcylcblxuICAgICAgZm9yIChjb25zdCBzb3J0RGVmIG9mIHNvcnRzKSB7XG4gICAgICAgIHRoaXMuc29ydChbW3NvcnREZWYuYXR0cmlidXRlLCBzb3J0RGVmLmRpcmVjdGlvbl1dKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3Qgd2l0aCByZXF1aXJlZCByb290IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtyZXF1aXJlZEF0dHJpYnV0ZXNdIC0gRXh0cmEgcmVxdWlyZWQgYXR0cmlidXRlcyBmb3IgdGhlIHJvb3QgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IC0gU2VsZWN0IG1hcCB3aXRoIHJlcXVpcmVkIHJvb3QgYXR0cmlidXRlcyBtZXJnZWQgd2hlbiByb290IHNlbGVjdCBleGlzdHMuXG4gICAqL1xuICBzZWxlY3RXaXRoUmVxdWlyZWRSb290QXR0cmlidXRlcyhyZXF1aXJlZEF0dHJpYnV0ZXMgPSBbXSkge1xuICAgIGNvbnN0IHJvb3RNb2RlbE5hbWUgPSB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCBzZWxlY3RNYXAgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi8gKHRoaXMuX3NlbGVjdClcbiAgICBjb25zdCBleGlzdGluZ1Jvb3RBdHRyaWJ1dGVzID0gc2VsZWN0TWFwW3Jvb3RNb2RlbE5hbWVdXG5cbiAgICBpZiAoIWV4aXN0aW5nUm9vdEF0dHJpYnV0ZXMpIHtcbiAgICAgIHJldHVybiBzZWxlY3RNYXBcbiAgICB9XG5cbiAgICBjb25zdCByb290UHJpbWFyeUtleSA9IHRoaXMubW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5zZWxlY3RNYXAsXG4gICAgICBbcm9vdE1vZGVsTmFtZV06IEFycmF5LmZyb20obmV3IFNldChbXG4gICAgICAgIC4uLihBcnJheS5pc0FycmF5KHJvb3RQcmltYXJ5S2V5KSA/IHJvb3RQcmltYXJ5S2V5IDogW3Jvb3RQcmltYXJ5S2V5XSksXG4gICAgICAgIC4uLmV4aXN0aW5nUm9vdEF0dHJpYnV0ZXMsXG4gICAgICAgIC4uLnJlcXVpcmVkQXR0cmlidXRlc1xuICAgICAgXSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIHRvIG1lcmdlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCBwcmVsb2Fkcy5cbiAgICovXG4gIHByZWxvYWQocHJlbG9hZCkge1xuICAgIG1lcmdlUHJlbG9hZFJlY29yZCh0aGlzLl9wcmVsb2FkLCBub3JtYWxpemVQcmVsb2FkKHByZWxvYWQpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgbWVyZ2VTZWxlY3RSZWNvcmQodGhpcy5fc2VsZWN0LCBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIGBzZWxlY3QoLi4uKWAsIGJ1dCBrZWVwcyB0aGUgZGVmYXVsdCBzZXJpYWxpemVkIGF0dHJpYnV0ZXMgYW5kIGxvYWRzXG4gICAqIHRoZSBnaXZlbiBleHRyYXMgaW4gYWRkaXRpb24gKGZvciBleGFtcGxlIGF0dHJpYnV0ZXMgZGVjbGFyZWRcbiAgICogYHNlbGVjdGVkQnlEZWZhdWx0OiBmYWxzZWApLiBLZXllZCBieSBtb2RlbCBuYW1lLCB3aXRoIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIGV4dHJhIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgbWVyZ2VTZWxlY3RSZWNvcmQodGhpcy5fc2VsZWN0c0V4dHJhLCBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGpvaW5zIC0gUmVsYXRpb25zaGlwIGRlc2NyaXB0b3Igam9pbnMuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIGpvaW5zLlxuICAgKi9cbiAgam9pbnMoam9pbnMpIHtcbiAgICBtZXJnZUpvaW5SZWNvcmQodGhpcy5fam9pbnMsIG5vcm1hbGl6ZUpvaW5zKGpvaW5zKSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2VhcmNoIHJlc3VsdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwiPlwiIHwgXCI+PVwiIHwgXCI8XCIgfCBcIjw9XCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBzZWFyY2guXG4gICAqL1xuICBzZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc2VhcmNoIHBhdGggbXVzdCBiZSBhbiBhcnJheSwgZ290OiAke3R5cGVvZiBwYXRofWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBwYXRoRW50cnkgb2YgcGF0aCkge1xuICAgICAgaWYgKHR5cGVvZiBwYXRoRW50cnkgIT09IFwic3RyaW5nXCIgfHwgcGF0aEVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2VhcmNoIHBhdGggZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb2x1bW4gIT09IFwic3RyaW5nXCIgfHwgY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNlYXJjaCBjb2x1bW4gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG9wZXJhdG9yICE9PSBcInN0cmluZ1wiIHx8IG9wZXJhdG9yLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNlYXJjaCBvcGVyYXRvciBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRvciA9IG5vcm1hbGl6ZVNlYXJjaE9wZXJhdG9yKG9wZXJhdG9yKVxuXG4gICAgdGhpcy5fc2VhcmNoZXMucHVzaCh7XG4gICAgICBjb2x1bW4sXG4gICAgICBvcGVyYXRvcjogbm9ybWFsaXplZE9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnBhdGhdLFxuICAgICAgdmFsdWVcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc29ydChzb3J0KSB7XG4gICAgdGhpcy5fc29ydC5wdXNoKC4uLm5vcm1hbGl6ZVNvcnQoc29ydCkpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gb3JkZXIgLSBPcmRlciBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGFwcGVuZGVkIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvcmRlcihvcmRlcikge1xuICAgIHJldHVybiB0aGlzLnNvcnQob3JkZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBncm91cCBkZWZpbml0aW9ucy5cbiAgICovXG4gIGdyb3VwKGdyb3VwKSB7XG4gICAgdGhpcy5fZ3JvdXAucHVzaCguLi5ub3JtYWxpemVHcm91cChncm91cCkpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFdoZXRoZXIgdG8gcmVxdWVzdCBkaXN0aW5jdCByb3dzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGRpc3RpbmN0IGZsYWcuXG4gICAqL1xuICBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBkaXN0aW5jdCBtdXN0IGJlIGEgYm9vbGVhbiwgZ290OiAke3R5cGVvZiB2YWx1ZX1gKVxuICAgIH1cblxuICAgIHRoaXMuX2Rpc3RpbmN0ID0gdmFsdWVcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGltaXQgcmVzdWx0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgbGltaXQodmFsdWUpIHtcbiAgICB0aGlzLl9saW1pdCA9IG5vcm1hbGl6ZUludGVnZXJBcmd1bWVudCh2YWx1ZSwgXCJsaW1pdFwiLCB7bWluOiAwfSlcbiAgICB0aGlzLl9wYWdlID0gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBvZmZzZXQodmFsdWUpIHtcbiAgICB0aGlzLl9vZmZzZXQgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQodmFsdWUsIFwib2Zmc2V0XCIsIHttaW46IDB9KVxuICAgIHRoaXMuX3BhZ2UgPSBudWxsXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIHBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHRoaXMuX3BhZ2UgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQocGFnZU51bWJlciwgXCJwYWdlXCIsIHttaW46IDF9KVxuICAgIGNvbnN0IHBhZ2VTaXplID0gdGhpcy5fcGVyUGFnZSB8fCAzMFxuXG4gICAgdGhpcy5fbGltaXQgPSBwYWdlU2l6ZVxuICAgIHRoaXMuX29mZnNldCA9ICh0aGlzLl9wYWdlIC0gMSkgKiBwYWdlU2l6ZVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBwZXItcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgcGVyUGFnZShwZXJQYWdlKSB7XG4gICAgdGhpcy5fcGVyUGFnZSA9IG5vcm1hbGl6ZUludGVnZXJBcmd1bWVudChwZXJQYWdlLCBcInBlclBhZ2VcIiwge21pbjogMX0pXG5cbiAgICBpZiAodGhpcy5fcGFnZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5fbGltaXQgPSB0aGlzLl9wZXJQYWdlXG4gICAgICB0aGlzLl9vZmZzZXQgPSAodGhpcy5fcGFnZSAtIDEpICogdGhpcy5fcGVyUGFnZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9uZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBDbG9uZWQgcXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjbG9uZSgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7XG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICBwcmVsb2FkOiBub3JtYWxpemVQcmVsb2FkKHRoaXMuX3ByZWxvYWQpXG4gICAgfSkpXG5cbiAgICBuZXdRdWVyeS5fam9pbnMgPSBub3JtYWxpemVKb2lucyh0aGlzLl9qb2lucylcbiAgICBuZXdRdWVyeS5fd2hlcmUgPSB7Li4udGhpcy5fd2hlcmV9XG4gICAgbmV3UXVlcnkuX3JhbnNhY2sgPSB0aGlzLl9yYW5zYWNrLm1hcCgocmFuc2Fja1BhcmFtcykgPT4gKHsuLi5yYW5zYWNrUGFyYW1zfSkpXG4gICAgbmV3UXVlcnkuX3NlYXJjaGVzID0gdGhpcy5fc2VhcmNoZXMubWFwKChzZWFyY2gpID0+ICh7XG4gICAgICBjb2x1bW46IHNlYXJjaC5jb2x1bW4sXG4gICAgICBvcGVyYXRvcjogc2VhcmNoLm9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnNlYXJjaC5wYXRoXSxcbiAgICAgIHZhbHVlOiBzZWFyY2gudmFsdWVcbiAgICB9KSlcbiAgICBuZXdRdWVyeS5fc2VsZWN0ID0gbm9ybWFsaXplU2VsZWN0KHRoaXMuX3NlbGVjdClcbiAgICBuZXdRdWVyeS5fc2VsZWN0c0V4dHJhID0gbm9ybWFsaXplU2VsZWN0KHRoaXMuX3NlbGVjdHNFeHRyYSlcbiAgICBuZXdRdWVyeS5fc29ydCA9IHRoaXMuX3NvcnQubWFwKChzb3J0RW50cnkpID0+ICh7XG4gICAgICBjb2x1bW46IHNvcnRFbnRyeS5jb2x1bW4sXG4gICAgICBkaXJlY3Rpb246IHNvcnRFbnRyeS5kaXJlY3Rpb24sXG4gICAgICBwYXRoOiBbLi4uc29ydEVudHJ5LnBhdGhdXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX2dyb3VwID0gdGhpcy5fZ3JvdXAubWFwKChncm91cEVudHJ5KSA9PiAoe1xuICAgICAgY29sdW1uOiBncm91cEVudHJ5LmNvbHVtbixcbiAgICAgIHBhdGg6IFsuLi5ncm91cEVudHJ5LnBhdGhdXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX2Rpc3RpbmN0ID0gdGhpcy5fZGlzdGluY3RcbiAgICBuZXdRdWVyeS5fbGltaXQgPSB0aGlzLl9saW1pdFxuICAgIG5ld1F1ZXJ5Ll9vZmZzZXQgPSB0aGlzLl9vZmZzZXRcbiAgICBuZXdRdWVyeS5fcGFnZSA9IHRoaXMuX3BhZ2VcbiAgICBuZXdRdWVyeS5fcGVyUGFnZSA9IHRoaXMuX3BlclBhZ2VcbiAgICBuZXdRdWVyeS5fd2l0aENvdW50ID0gdGhpcy5fd2l0aENvdW50Lm1hcCgoZW50cnkpID0+ICh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBlbnRyeS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IHsuLi5lbnRyeS53aGVyZX0gOiB1bmRlZmluZWRcbiAgICB9KSlcbiAgICBuZXdRdWVyeS5fcXVlcnlEYXRhID0gdGhpcy5fcXVlcnlEYXRhLm1hcCgoZW50cnkpID0+IChcbiAgICAgIHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiA/IGVudHJ5IDogey4uLmVudHJ5fVxuICAgICkpXG4gICAgbmV3UXVlcnkuX2FiaWxpdGllcyA9IHRoaXMuX2FiaWxpdGllcy5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgYWN0aW9uczogWy4uLmVudHJ5LmFjdGlvbnNdLFxuICAgICAgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWVcbiAgICB9KSlcblxuICAgIHJldHVybiBuZXdRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBSb290IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBwcmVsb2FkIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcHJlbG9hZFBheWxvYWQoKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3ByZWxvYWQpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge3ByZWxvYWQ6IHRoaXMuX3ByZWxvYWR9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvdW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCB3aXRoQ291bnQgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgd2l0aENvdW50UGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fd2l0aENvdW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgd2l0aENvdW50OiB0aGlzLl93aXRoQ291bnQubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogZW50cnkuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlIHx8IHVuZGVmaW5lZFxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBhYmlsaXRpZXMgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgYWJpbGl0aWVzUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fYWJpbGl0aWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLl9hYmlsaXRpZXMubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgYWN0aW9uczogWy4uLmVudHJ5LmFjdGlvbnNdLFxuICAgICAgICBtb2RlbE5hbWU6IGVudHJ5Lm1vZGVsTmFtZVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgZGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgcXVlcnlEYXRhIHNwZWMgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcXVlcnlEYXRhUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fcXVlcnlEYXRhLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICAvLyBTaW5nbGUgYWNjdW11bGF0ZWQgc3BlYyBnb2VzIG9uIHRoZSB3aXJlIHZlcmJhdGltLiBUaGUgYmFja2VuZFxuICAgIC8vIG5vcm1hbGl6ZXIgYWNjZXB0cyBzdHJpbmcvYXJyYXkvb2JqZWN0IGF0IGVhY2ggbGV2ZWwsIHNvIHdlIGNhblxuICAgIC8vIHNoaXAgbXVsdGlwbGUgYC5xdWVyeURhdGEoLi4uKWAgY2FsbHMgYXMgYW4gYXJyYXkuXG4gICAgcmV0dXJuIHtcbiAgICAgIHF1ZXJ5RGF0YTogdGhpcy5fcXVlcnlEYXRhLmxlbmd0aCA9PT0gMSA/IHRoaXMuX3F1ZXJ5RGF0YVswXSA6IHRoaXMuX3F1ZXJ5RGF0YVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbcmVxdWlyZWRBdHRyaWJ1dGVzXSAtIEV4dHJhIHJlcXVpcmVkIGF0dHJpYnV0ZXMgZm9yIHJvb3QgbW9kZWwgc2VsZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VsZWN0IGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VsZWN0UGF5bG9hZChyZXF1aXJlZEF0dHJpYnV0ZXMgPSBbXSkge1xuICAgIGNvbnN0IHNlbGVjdCA9IHRoaXMuc2VsZWN0V2l0aFJlcXVpcmVkUm9vdEF0dHJpYnV0ZXMocmVxdWlyZWRBdHRyaWJ1dGVzKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHNlbGVjdCkubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7c2VsZWN0fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0cyBleHRyYSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VsZWN0c0V4dHJhIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VsZWN0c0V4dHJhUGF5bG9hZCgpIHtcbiAgICBpZiAoT2JqZWN0LmtleXModGhpcy5fc2VsZWN0c0V4dHJhKS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtzZWxlY3RzRXh0cmE6IHRoaXMuX3NlbGVjdHNFeHRyYX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlYXJjaCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VhcmNoZXMgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VhcmNoUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fc2VhcmNoZXMubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBzZWFyY2hlczogdGhpcy5fc2VhcmNoZXMubWFwKChzZWFyY2gpID0+ICh7XG4gICAgICAgIGNvbHVtbjogc2VhcmNoLmNvbHVtbixcbiAgICAgICAgb3BlcmF0b3I6IHNlYXJjaC5vcGVyYXRvcixcbiAgICAgICAgcGF0aDogWy4uLnNlYXJjaC5wYXRoXSxcbiAgICAgICAgdmFsdWU6IHNlYXJjaC52YWx1ZVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2FjayBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgcmFuc2FjayBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHJhbnNhY2tQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLl9yYW5zYWNrLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICBpZiAodGhpcy5fcmFuc2Fjay5sZW5ndGggPT09IDEpIHtcbiAgICAgIHJldHVybiB7cmFuc2FjazogdGhpcy5fcmFuc2Fja1swXX1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcmFuc2Fjazoge1xuICAgICAgICBnOiB0aGlzLl9yYW5zYWNrLFxuICAgICAgICBtOiBcImFuZFwiXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIGpvaW5zIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgam9pbnNQYXlsb2FkKCkge1xuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9qb2lucykubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBqb2luczogbm9ybWFsaXplSm9pbnModGhpcy5fam9pbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc29ydCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc29ydCBhcnJheSB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBzb3J0UGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fc29ydC5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNvcnQ6IHRoaXMuX3NvcnQubWFwKChzb3J0RW50cnkpID0+ICh7XG4gICAgICAgIGNvbHVtbjogc29ydEVudHJ5LmNvbHVtbixcbiAgICAgICAgZGlyZWN0aW9uOiBzb3J0RW50cnkuZGlyZWN0aW9uLFxuICAgICAgICBwYXRoOiBbLi4uc29ydEVudHJ5LnBhdGhdXG4gICAgICB9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgZ3JvdXAgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgZ3JvdXBQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLl9ncm91cC5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGdyb3VwOiB0aGlzLl9ncm91cC5tYXAoKGdyb3VwRW50cnkpID0+ICh7XG4gICAgICAgIGNvbHVtbjogZ3JvdXBFbnRyeS5jb2x1bW4sXG4gICAgICAgIHBhdGg6IFsuLi5ncm91cEVudHJ5LnBhdGhdXG4gICAgICB9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXN0aW5jdCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgZGlzdGluY3QgZmxhZyB3aGVuIGVuYWJsZWQuXG4gICAqL1xuICBkaXN0aW5jdFBheWxvYWQoKSB7XG4gICAgaWYgKCF0aGlzLl9kaXN0aW5jdCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGlzdGluY3Q6IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgd2hlcmUgaGFzaCB3aGVuIHByZXNlbnQuXG4gICAqL1xuICB3aGVyZVBheWxvYWQoKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3doZXJlKS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHdoZXJlOiB0aGlzLl93aGVyZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2luYXRpb24gcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHBhZ2luYXRpb24gcGFyYW1zIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHBhZ2luYXRpb25QYXlsb2FkKCkge1xuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGlmICh0aGlzLl9saW1pdCAhPT0gbnVsbCkgcGF5bG9hZC5saW1pdCA9IHRoaXMuX2xpbWl0XG4gICAgaWYgKHRoaXMuX29mZnNldCAhPT0gbnVsbCkgcGF5bG9hZC5vZmZzZXQgPSB0aGlzLl9vZmZzZXRcbiAgICBpZiAodGhpcy5fcGFnZSAhPT0gbnVsbCkgcGF5bG9hZC5wYWdlID0gdGhpcy5fcGFnZVxuICAgIGlmICh0aGlzLl9wZXJQYWdlICE9PSBudWxsKSBwYXlsb2FkLnBlclBhZ2UgPSB0aGlzLl9wZXJQYWdlXG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGV2ZW50IHF1ZXJ5IHN1cHBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqIEB0aHJvd3Mge0Vycm9yfSBXaGVuIHRoZSBxdWVyeSBjb250YWlucyBsaXN0LW9ubHkgb3B0aW9ucyB0aGF0IGNhbm5vdCBmaWx0ZXIgYSBzaW5nbGUgbGlmZWN5Y2xlIGV2ZW50LlxuICAgKi9cbiAgYXNzZXJ0RXZlbnRRdWVyeVN1cHBvcnRlZCgpIHtcbiAgICAvKipcbiAgICAgKiBVbnN1cHBvcnRlZCBvcHRpb25zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB1bnN1cHBvcnRlZE9wdGlvbnMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX3NvcnQubGVuZ3RoID4gMCkgdW5zdXBwb3J0ZWRPcHRpb25zLnB1c2goXCJzb3J0XCIpXG4gICAgaWYgKHRoaXMuX2dyb3VwLmxlbmd0aCA+IDApIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwiZ3JvdXBcIilcbiAgICBpZiAodGhpcy5fZGlzdGluY3QpIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwiZGlzdGluY3RcIilcbiAgICBpZiAodGhpcy5fcmFuc2Fjay5sZW5ndGggPiAwKSB1bnN1cHBvcnRlZE9wdGlvbnMucHVzaChcInJhbnNhY2tcIilcbiAgICBpZiAodGhpcy5fbGltaXQgIT09IG51bGwgfHwgdGhpcy5fb2Zmc2V0ICE9PSBudWxsIHx8IHRoaXMuX3BhZ2UgIT09IG51bGwgfHwgdGhpcy5fcGVyUGFnZSAhPT0gbnVsbCkgdW5zdXBwb3J0ZWRPcHRpb25zLnB1c2goXCJwYWdpbmF0aW9uXCIpXG5cbiAgICBpZiAodW5zdXBwb3J0ZWRPcHRpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJpZXMgZG8gbm90IHN1cHBvcnQgJHt1bnN1cHBvcnRlZE9wdGlvbnMuam9pbihcIiwgXCIpfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gUHJvamVjdGlvbiBwYXlsb2FkIHVzZWQgd2hlbiBzZXJpYWxpemluZyBsaWZlY3ljbGUgZXZlbnRzLlxuICAgKi9cbiAgZXZlbnRQcm9qZWN0aW9uUGF5bG9hZCgpIHtcbiAgICB0aGlzLmFzc2VydEV2ZW50UXVlcnlTdXBwb3J0ZWQoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnRoaXMucHJlbG9hZFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWxlY3RzRXh0cmFQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndpdGhDb3VudFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuYWJpbGl0aWVzUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5xdWVyeURhdGFQYXlsb2FkKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsfSAtIFF1ZXJ5IHBpZWNlcyB1c2VkIHRvIG1hdGNoIGxpZmVjeWNsZSBldmVudHMuXG4gICAqL1xuICBldmVudEZpbHRlclBheWxvYWQoKSB7XG4gICAgdGhpcy5hc3NlcnRFdmVudFF1ZXJ5U3VwcG9ydGVkKClcblxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndoZXJlUGF5bG9hZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHBheWxvYWQpLmxlbmd0aCA9PT0gMCA/IG51bGwgOiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXZlbnRPcHRpb25zUGF5bG9hZCByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWR9IC0gQ29tYmluZWQgZXZlbnQgZmlsdGVyIGFuZCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gICAqL1xuICBldmVudE9wdGlvbnNQYXlsb2FkKCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyUGF5bG9hZCA9IHRoaXMuZXZlbnRGaWx0ZXJQYXlsb2FkKClcblxuICAgIHJldHVybiB7XG4gICAgICBldmVudEZpbHRlcktleTogZXZlbnRGaWx0ZXJQYXlsb2FkID8gZnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyS2V5KGV2ZW50RmlsdGVyUGF5bG9hZCkgOiBudWxsLFxuICAgICAgZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgcHJvamVjdGlvblBheWxvYWQ6IHRoaXMuZXZlbnRQcm9qZWN0aW9uUGF5bG9hZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiaW5kZXhcIiwge1xuICAgICAgLi4udGhpcy5wcmVsb2FkUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucmFuc2Fja1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWxlY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlbGVjdHNFeHRyYVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZ3JvdXBQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmRpc3RpbmN0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zb3J0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy53aGVyZVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2l0aENvdW50UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5hYmlsaXRpZXNQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnF1ZXJ5RGF0YVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucGFnaW5hdGlvblBheWxvYWQoKVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsc0RhdGEgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLm1vZGVscykgPyByZXNwb25zZS5tb2RlbHMgOiBbXVxuICAgIC8qKlxuICAgICAqIE1vZGVscy5cbiAgICAgKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+W119ICovXG4gICAgY29uc3QgbW9kZWxzID0gbW9kZWxzRGF0YS5tYXAoKG1vZGVsKSA9PiB0aGlzLm1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UobW9kZWwpKVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyBzbyBhdXRvLWJhdGNoLXByZWxvYWRcbiAgICAvLyBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLiBTaW5nbGUtcmVjb3JkIGxvb2t1cHMgc3RpbGwgZmxvd1xuICAgIC8vIHRocm91Z2ggaGVyZSAod2l0aCBhIGNvaG9ydCBvZiBvbmUpIGFuZCBkZWdyYWRlIGNsZWFubHkgdG8gcGVyLXJlY29yZCBsb2FkLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobW9kZWwpLl9sb2FkQ29ob3J0ID0gbW9kZWxzXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJpbmRleFwiLCB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5yYW5zYWNrUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2hlcmVQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnBhZ2luYXRpb25QYXlsb2FkKCksXG4gICAgICBjb3VudDogdHJ1ZVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHJlc3BvbnNlLmNvdW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBudW1lcmljIGNvdW50IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2UuY291bnR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBtYXRjaGluZyBxdWVyeS5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5jbG9uZSgpXG5cbiAgICBpZiAocXVlcnkuX3NvcnQubGVuZ3RoIDwgMSkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMubW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgICAgcXVlcnkuc29ydCgoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHByaW1hcnlLZXkgOiBbcHJpbWFyeUtleV0pLm1hcCgoY29sdW1uKSA9PiBbY29sdW1uLCBcImFzY1wiXSkpXG4gICAgfVxuXG4gICAgcXVlcnkubGltaXQoMSlcblxuICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHF1ZXJ5LnRvQXJyYXkoKVxuXG4gICAgcmV0dXJuIG1vZGVsc1swXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBMYXN0IG1vZGVsIG1hdGNoaW5nIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgbGFzdCgpIHtcbiAgICAvLyBXaGVuIHBhZ2luYXRpb24gaXMgYWxyZWFkeSBhcHBsaWVkLCBmZXRjaCB0aGF0IHNjb3BlZCB3aW5kb3cgYW5kIHJldHVybiBpdHMgbGFzdCBpdGVtLlxuICAgIGlmICh0aGlzLl9vZmZzZXQgIT09IG51bGwgfHwgdGhpcy5fcGFnZSAhPT0gbnVsbCB8fCB0aGlzLl9wZXJQYWdlICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBtb2RlbHMgPSBhd2FpdCB0aGlzLnRvQXJyYXkoKVxuXG4gICAgICBpZiAobW9kZWxzLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiBtb2RlbHNbbW9kZWxzLmxlbmd0aCAtIDFdXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLmNsb25lKClcblxuICAgIGlmIChxdWVyeS5fc29ydC5sZW5ndGggPCAxKSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5tb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgICBxdWVyeS5zb3J0KChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleSA6IFtwcmltYXJ5S2V5XSkubWFwKChjb2x1bW4pID0+IFtjb2x1bW4sIFwiZGVzY1wiXSkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5Ll9zb3J0ID0gcXVlcnkuX3NvcnQubWFwKChzb3J0RW50cnkpID0+ICh7XG4gICAgICAgIC4uLnNvcnRFbnRyeSxcbiAgICAgICAgZGlyZWN0aW9uOiByZXZlcnNlU29ydERpcmVjdGlvbihzb3J0RW50cnkuZGlyZWN0aW9uKVxuICAgICAgfSkpXG4gICAgfVxuXG4gICAgcXVlcnkubGltaXQoMSlcblxuICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHF1ZXJ5LnRvQXJyYXkoKVxuXG4gICAgcmV0dXJuIG1vZGVsc1swXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHBhcmFtIHsuLi4oc3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+KX0gY29sdW1ucyAtIFBsdWNrIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGx1Y2tlZCB2YWx1ZXMuXG4gICAqL1xuICBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgaWYgKGNvbHVtbnMubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQbHVjayA9IG5vcm1hbGl6ZVBsdWNrKGNvbHVtbnMubGVuZ3RoID09PSAxID8gY29sdW1uc1swXSA6IGNvbHVtbnMpXG4gICAgY29uc3QgYWxsb3dlZFBsdWNrID0gYXNzZXJ0UGx1Y2tEZWZpbml0aW9uc0FsbG93ZWQoe1xuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgcGx1Y2s6IG5vcm1hbGl6ZWRQbHVja1xuICAgIH0pXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJpbmRleFwiLCB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc29ydFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2hlcmVQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnBhZ2luYXRpb25QYXlsb2FkKCksXG4gICAgICBwbHVjazogYWxsb3dlZFBsdWNrXG4gICAgfSlcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCByZXNwb25zZSBidXQgZ290OiAke3Jlc3BvbnNlfWApXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc3BvbnNlLnZhbHVlcykpIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZS52YWx1ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEZvdW5kIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZChpZCkge1xuICAgIGNvbnN0IHBrID0gdGhpcy5tb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwaywgaWQpKVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gbm90IGZvdW5kIHdpdGggJHtwa309JHtKU09OLnN0cmluZ2lmeShpZCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gRm91bmQgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbmRpdGlvbnMgPSB0aGlzLnZhbGlkYXRlZFN0cnVjdHVyZWRDb25kaXRpb25zKGNvbmRpdGlvbnMpXG4gICAgY29uc3QgbWVyZ2VkV2hlcmUgPSB7XG4gICAgICAuLi50aGlzLl93aGVyZSxcbiAgICAgIC4uLm5vcm1hbGl6ZWRDb25kaXRpb25zXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJpbmRleFwiLCB7XG4gICAgICAuLi50aGlzLnByZWxvYWRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlbGVjdFBheWxvYWQoT2JqZWN0LmtleXMobWVyZ2VkV2hlcmUpKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0c0V4dHJhUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5ncm91cFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZGlzdGluY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNvcnRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmFiaWxpdGllc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucGFnaW5hdGlvblBheWxvYWQoKSxcbiAgICAgIHdoZXJlOiBtZXJnZWRXaGVyZVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVscyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2UubW9kZWxzKSA/IHJlc3BvbnNlLm1vZGVscyA6IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsRGF0YSBvZiBtb2RlbHMpIHtcbiAgICAgIGNvbnN0IG1vZGVsID0gdGhpcy5tb2RlbENsYXNzLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKG1vZGVsRGF0YSlcblxuICAgICAgaWYgKHRoaXMubW9kZWxDbGFzcy5tYXRjaGVzRmluZEJ5Q29uZGl0aW9ucyhtb2RlbCwgbWVyZ2VkV2hlcmUpKSB7XG4gICAgICAgIHJldHVybiBtb2RlbFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBGb3VuZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQgZm9yIGNvbmRpdGlvbnM6ICR7c2VyaWFsaXplRmluZENvbmRpdGlvbnMoY29uZGl0aW9ucyl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29uZGl0aW9ucyA9IHRoaXMudmFsaWRhdGVkU3RydWN0dXJlZENvbmRpdGlvbnMoY29uZGl0aW9ucylcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZmluZEJ5KGNvbmRpdGlvbnMpXG5cbiAgICBpZiAobW9kZWwpIHJldHVybiBtb2RlbFxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPikgPT4gSW5zdGFuY2VUeXBlPFQ+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcy5tb2RlbENsYXNzKSlcblxuICAgIHJldHVybiBuZXcgTW9kZWxDbGFzcygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChub3JtYWxpemVkQ29uZGl0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGNyZWF0ZSBieS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhtb2RlbDogSW5zdGFuY2VUeXBlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gW2NhbGxiYWNrXSAtIE9wdGlvbmFsIGNhbGxiYWNrIGJlZm9yZSBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIG5ld2x5IGNyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRDb25kaXRpb25zID0gdGhpcy52YWxpZGF0ZWRTdHJ1Y3R1cmVkQ29uZGl0aW9ucyhjb25kaXRpb25zKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmIChtb2RlbCkgcmV0dXJuIG1vZGVsXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KSA9PiBJbnN0YW5jZVR5cGU8VD59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MpKVxuICAgIGNvbnN0IG5ld01vZGVsID0gbmV3IE1vZGVsQ2xhc3MoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAobm9ybWFsaXplZENvbmRpdGlvbnMpKVxuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjayhuZXdNb2RlbClcbiAgICB9XG5cbiAgICBhd2FpdCBuZXdNb2RlbC5zYXZlKClcblxuICAgIHJldHVybiBuZXdNb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdmFsaWRhdGVkIHN0cnVjdHVyZWQgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDYW5kaWRhdGUgc3RydWN0dXJlZCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFZhbGlkYXRlZCBjb25kaXRpb25zLlxuICAgKi9cbiAgdmFsaWRhdGVkU3RydWN0dXJlZENvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIHRoaXMubW9kZWxDbGFzcy5hc3NlcnRGaW5kQnlDb25kaXRpb25zKGNvbmRpdGlvbnMpXG5cbiAgICByZXR1cm4gY29uZGl0aW9uc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBmaWx0ZXIga2V5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkfSBwYXlsb2FkIC0gRXZlbnQgZmlsdGVyIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBrZXkgZm9yIGV2ZW50IGZpbHRlciBtYXRjaGluZy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyS2V5KHBheWxvYWQpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpXG59XG5cbi8qKlxuICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gcXVlcnkgLSBRdWVyeSByZWNlaXZpbmcgcHJvamVjdGlvbiBvcHRpb25zLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnN9IG9wdGlvbnMgLSBQcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnMocXVlcnksIG9wdGlvbnMpIHtcbiAgaWYgKG9wdGlvbnMuc2VsZWN0ICE9PSB1bmRlZmluZWQpIHF1ZXJ5LnNlbGVjdChvcHRpb25zLnNlbGVjdClcbiAgaWYgKG9wdGlvbnMuc2VsZWN0c0V4dHJhICE9PSB1bmRlZmluZWQpIHF1ZXJ5LnNlbGVjdHNFeHRyYShvcHRpb25zLnNlbGVjdHNFeHRyYSlcbiAgaWYgKG9wdGlvbnMucHJlbG9hZCAhPT0gdW5kZWZpbmVkKSBxdWVyeS5wcmVsb2FkKG9wdGlvbnMucHJlbG9hZClcbiAgaWYgKG9wdGlvbnMud2l0aENvdW50ICE9PSB1bmRlZmluZWQpIHF1ZXJ5LndpdGhDb3VudChvcHRpb25zLndpdGhDb3VudClcbiAgaWYgKG9wdGlvbnMuYWJpbGl0aWVzICE9PSB1bmRlZmluZWQpIHF1ZXJ5LmFiaWxpdGllcyhvcHRpb25zLmFiaWxpdGllcylcbiAgaWYgKG9wdGlvbnMucXVlcnlEYXRhICE9PSB1bmRlZmluZWQpIHF1ZXJ5LnF1ZXJ5RGF0YShvcHRpb25zLnF1ZXJ5RGF0YSlcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeSBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUXVlcnk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IHF1ZXJ5IC0gRXZlbnQgcXVlcnkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RnJvbnRlbmRNb2RlbEV2ZW50UXVlcnlDbGFzcyhtb2RlbENsYXNzLCBxdWVyeSkge1xuICBpZiAocXVlcnkubW9kZWxDbGFzcyA9PT0gbW9kZWxDbGFzcykgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3Qgc3Vic2NyaWJlICR7bW9kZWxDbGFzcy5uYW1lfSBldmVudHMgd2l0aCBhICR7cXVlcnkubW9kZWxDbGFzcy5uYW1lfSBxdWVyeWApXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZnJvbnRlbmQgbW9kZWwgZXZlbnQgb3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IG9wdGlvbnMgLSBDYW5kaWRhdGUgZXZlbnQgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0KG9wdGlvbnMpIHtcbiAgaWYgKG9wdGlvbnMgJiYgdHlwZW9mIG9wdGlvbnMgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgZXZlbnQgb3B0aW9ucyBtdXN0IGJlIGEgcXVlcnkgb3IgYW4gb3B0aW9ucyBvYmplY3QsIGdvdDogJHtvcHRpb25zfWApXG59XG5cbi8qKlxuICogUnVucyBjbG9uZWQgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBxdWVyeSAtIEV2ZW50IHF1ZXJ5LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gLSBDbG9uZWQgcXVlcnkgdXNlZCBieSBldmVudCBzdWJzY3JpcHRpb25zLlxuICovXG5mdW5jdGlvbiBjbG9uZWRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBxdWVyeSkge1xuICBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeUNsYXNzKG1vZGVsQ2xhc3MsIHF1ZXJ5KVxuXG4gIHJldHVybiBxdWVyeS5jbG9uZSgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeSBmcm9tIG9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IG9wdGlvbnMgLSBFdmVudCBvcHRpb25zIG9iamVjdC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IC0gUXVlcnkgdXNlZCBieSBldmVudCBzdWJzY3JpcHRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeUZyb21PcHRpb25zT2JqZWN0KG1vZGVsQ2xhc3MsIG9wdGlvbnMpIHtcbiAgaWYgKG9wdGlvbnMucXVlcnkgIT09IHVuZGVmaW5lZCAmJiAhKG9wdGlvbnMucXVlcnkgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsUXVlcnkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnQgb3B0aW9uIHF1ZXJ5IG11c3QgYmUgYSBGcm9udGVuZE1vZGVsUXVlcnlcIilcbiAgfVxuXG4gIGNvbnN0IHF1ZXJ5ID0gb3B0aW9ucy5xdWVyeVxuICAgID8gb3B0aW9ucy5xdWVyeS5jbG9uZSgpXG4gICAgOiBuZXcgRnJvbnRlbmRNb2RlbFF1ZXJ5KHttb2RlbENsYXNzfSlcblxuICBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeUNsYXNzKG1vZGVsQ2xhc3MsIHF1ZXJ5KVxuXG4gIHJldHVybiBxdWVyeVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcXVlcnkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcHJvamVjdGlvbiBvcHRpb25zLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gLSBOb3JtYWxpemVkIHF1ZXJ5IHVzZWQgYnkgZXZlbnQgc3Vic2NyaXB0aW9ucy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50UXVlcnkobW9kZWxDbGFzcywgb3B0aW9ucyA9IHt9KSB7XG4gIGlmIChvcHRpb25zIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFF1ZXJ5KSByZXR1cm4gY2xvbmVkRnJvbnRlbmRNb2RlbEV2ZW50UXVlcnkobW9kZWxDbGFzcywgb3B0aW9ucylcblxuICBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0KG9wdGlvbnMpXG5cbiAgY29uc3Qgb3B0aW9uc09iamVjdCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gKi8gKG9wdGlvbnMpXG4gIGNvbnN0IHF1ZXJ5ID0gZnJvbnRlbmRNb2RlbEV2ZW50UXVlcnlGcm9tT3B0aW9uc09iamVjdChtb2RlbENsYXNzLCBvcHRpb25zT2JqZWN0KVxuXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFByb2plY3Rpb25PcHRpb25zKHF1ZXJ5LCBvcHRpb25zT2JqZWN0KVxuXG4gIHJldHVybiBxdWVyeVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWR9IC0gTm9ybWFsaXplZCBldmVudCBzdWJzY3JpcHRpb24gcGF5bG9hZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKG1vZGVsQ2xhc3MsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IG9wdGlvbnMgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsUXVlcnkgPyB1bmRlZmluZWQgOiBvcHRpb25zLnJlcXVlc3RDb250ZXh0XG5cbiAgcmV0dXJuIHtcbiAgICAuLi5mcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zKS5ldmVudE9wdGlvbnNQYXlsb2FkKCksXG4gICAgcmVxdWVzdENvbnRleHRcbiAgfVxufVxuIl19