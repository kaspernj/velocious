// @ts-check
import { resolveFrontendModelClass } from "./model-registry.js";
import { normalizeRansackGroup, parseRansackSort } from "../utils/ransack.js";
import { isModelScopeDescriptor } from "../utils/model-scope.js";
import isPlainObject from "../utils/plain-object.js";
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
            [rootModelName]: Array.from(new Set([rootPrimaryKey, ...existingRootAttributes, ...requiredAttributes]))
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
            query.sort([[this.modelClass.primaryKey(), "asc"]]);
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
            query.sort([[this.modelClass.primaryKey(), "desc"]]);
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
     * @param {number | string} id - Record id.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    async find(id) {
        const pk = this.modelClass.primaryKey();
        const model = await this.findBy({ [pk]: id });
        if (!model) {
            throw new Error(`${this.modelClass.getModelName()} not found with ${pk}=${id}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUVwRDs7Ozs7OztHQU9HO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7O0dBR0c7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0gsd0VBQXdFO0FBQ3hFLE1BQU0sT0FBTyx1QkFBd0IsU0FBUSxLQUFLO0lBQ2hEOzs7T0FHRztJQUNILFlBQVksT0FBTztRQUNqQixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFZCxJQUFJLENBQUMsSUFBSSxHQUFHLHlCQUF5QixDQUFBO0lBQ3ZDLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHVCQUF1QixDQUFDLE9BQU87SUFDdEMsT0FBTyxJQUFJLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxDQUFBO0FBQzdDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLGdCQUFnQixDQUFDLE9BQU87SUFDdEMsSUFBSSxDQUFDLE9BQU87UUFBRSxPQUFPLEVBQUUsQ0FBQTtJQUV2QixJQUFJLE9BQU8s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Ozs7OztHQUtHO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxHQUFHLEVBQUU7SUFDdkQsSUFBSSxPQUFPLFlBQVksa0JBQWtCO1FBQUUsT0FBTyw2QkFBNkIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFFcEcscUNBQXFDLENBQUMsT0FBTyxDQUFDLENBQUE7SUFFOUMsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUM5RSxNQUFNLEtBQUssR0FBRyx3Q0FBd0MsQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFFakYsbUNBQW1DLENBQUMsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBRXpELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLGdDQUFnQyxDQUFDLFVBQVUsRUFBRSxPQUFPLEdBQUcsRUFBRTtJQUN2RSxNQUFNLGNBQWMsR0FBRyxPQUFPLFlBQVksa0JBQWtCLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQTtJQUVqRyxPQUFPO1FBQ0wsR0FBRyx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUMsbUJBQW1CLEVBQUU7UUFDckUsY0FBYztLQUNmLENBQUE7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7cmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzc30gZnJvbSBcIi4vbW9kZWwtcmVnaXN0cnkuanNcIlxuaW1wb3J0IHtub3JtYWxpemVSYW5zYWNrR3JvdXAsIHBhcnNlUmFuc2Fja1NvcnR9IGZyb20gXCIuLi91dGlscy9yYW5zYWNrLmpzXCJcbmltcG9ydCB7aXNNb2RlbFNjb3BlRGVzY3JpcHRvcn0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxTZWFyY2ggdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzZWFyY2guXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHR5cGUuXG4gKiBAdHlwZWRlZiB7bnVsbCB8IGJvb2xlYW4gfCBudW1iZXIgfCBzdHJpbmcgfCBvYmplY3R9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZSB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fX0gRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3ttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119fSBGcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFByb2plY3Rpb25PcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IFtzZWxlY3RdIC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBbc2VsZWN0c0V4dHJhXSAtIEV4dHJhIGF0dHJpYnV0ZXMgdG8gbG9hZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gW3ByZWxvYWRdIC0gUmVsYXRpb25zaGlwIHByZWxvYWQgdHJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59IFt3aXRoQ291bnRdIC0gQXNzb2NpYXRpb24gY291bnQgc3BlYy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IFthYmlsaXRpZXNdIC0gQWJpbGl0eSBhY3Rpb25zIHRvIGNvbXB1dGUgcGVyIHJlY29yZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPj4gfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbcXVlcnlEYXRhXSAtIEJhY2tlbmQgcXVlcnkgZGF0YSBuYW1lcy9zcGVjLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxFdmVudFJvdXRpbmdPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsRXZlbnRSb3V0aW5nT3B0aW9uc1xuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUXVlcnk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IFtxdWVyeV0gLSBRdWVyeSB3aG9zZSBmaWx0ZXJzIG1hdGNoIGV2ZW50cyBhbmQgd2hvc2UgcHJvamVjdGlvbnMgc2hhcGUgZXZlbnQgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gW3JlcXVlc3RDb250ZXh0XSAtIFJlZ2lzdHJhdGlvbi1sb2NhbCByZW1vdGUgcm91dGluZyBjb250ZXh0LiBJdHMgY2FwdHVyZWQgdmFsdWUgcGFydGl0aW9ucyBsaWZlY3ljbGUgc2VydmVyIHN1YnNjcmlwdGlvbnMgYW5kIHJlcGxhY2VzIHRoZSB0cmFuc3BvcnQtd2lkZSBjb250ZXh0IGZvciB0aGlzIHJlZ2lzdHJhdGlvbi5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnMgJiBGcm9udGVuZE1vZGVsRXZlbnRSb3V0aW5nT3B0aW9uc30gRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdFxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0IHwgRnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbc2VsZWN0XSAtIE5vcm1hbGl6ZWQgc2VsZWN0IG1hcC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBbc2VsZWN0c0V4dHJhXSAtIE5vcm1hbGl6ZWQgZXh0cmEgc2VsZWN0IG1hcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gW3ByZWxvYWRdIC0gTm9ybWFsaXplZCBwcmVsb2FkIHRyZWUuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnlbXX0gW3dpdGhDb3VudF0gLSBOb3JtYWxpemVkIGNvdW50IHNwZWNzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5W119IFthYmlsaXRpZXNdIC0gTm9ybWFsaXplZCBhYmlsaXR5IHNwZWNzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IFtxdWVyeURhdGFdIC0gTm9ybWFsaXplZCBxdWVyeURhdGEgc3BlYy5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IFtqb2luc10gLSBSZWxhdGlvbnNoaXAgam9pbnMgbmVlZGVkIGZvciBtYXRjaGluZy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSBbc2VhcmNoZXNdIC0gU2VhcmNoIHByZWRpY2F0ZXMgbmVlZGVkIGZvciBtYXRjaGluZy5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gW3doZXJlXSAtIFN0cnVjdHVyZWQgd2hlcmUgcHJlZGljYXRlcyBuZWVkZWQgZm9yIG1hdGNoaW5nLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgJiB7a2V5OiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5UGF5bG9hZFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBldmVudEZpbHRlcktleSAtIFN0YWJsZSBldmVudCBmaWx0ZXIga2V5LCBvciBudWxsIHdoZW4gbm8gZmlsdGVyIGlzIHByZXNlbnQuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsfSBldmVudEZpbHRlclBheWxvYWQgLSBOb3JtYWxpemVkIGV2ZW50IGZpbHRlciBwYXlsb2FkLCBvciBudWxsIHdoZW4gdW5maWx0ZXJlZC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSBwcm9qZWN0aW9uUGF5bG9hZCAtIE5vcm1hbGl6ZWQgZXZlbnQgc2VyaWFsaXphdGlvbiBwcm9qZWN0aW9uIHBheWxvYWQuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWQgJiB7cmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWR9fSBGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZFxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU29ydFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHNvcnQgYnkuXG4gKiBAcHJvcGVydHkge1wiYXNjXCIgfCBcImRlc2NcIn0gZGlyZWN0aW9uIC0gU29ydCBkaXJlY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxHcm91cCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEdyb3VwXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gZ3JvdXAgYnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxQbHVjayB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFBsdWNrXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gcGx1Y2suXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICovXG4vKiogRXJyb3IgcmFpc2VkIHdoZW4gYSBmcm9udGVuZC1tb2RlbCBxdWVyeSBkZXNjcmlwdG9yIGlzIG1hbGZvcm1lZC4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsUXVlcnlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBmcm9udGVuZC1tb2RlbCBxdWVyeSBlcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG5cbiAgICB0aGlzLm5hbWUgPSBcIkZyb250ZW5kTW9kZWxRdWVyeUVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIHF1ZXJ5IGRlc2NyaXB0b3IgZXJyb3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3J9IC0gUXVlcnkgZGVzY3JpcHRvciBlcnJvci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IobWVzc2FnZSkge1xuICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpXG59XG5cbi8qKlxuICogUnVucyB0aGUgbm9ybWFsaXplUHJlbG9hZCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPiB8IGJvb2xlYW4gfCB1bmRlZmluZWQgfCBudWxsfSBwcmVsb2FkIC0gUHJlbG9hZCBzaG9ydGhhbmQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gLSBOb3JtYWxpemVkIHByZWxvYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQcmVsb2FkKHByZWxvYWQpIHtcbiAgaWYgKCFwcmVsb2FkKSByZXR1cm4ge31cblxuICBpZiAocHJlbG9hZCA9PT0gdHJ1ZSkgcmV0dXJuIHt9XG5cbiAgaWYgKHR5cGVvZiBwcmVsb2FkID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHtbcHJlbG9hZF06IHRydWV9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShwcmVsb2FkKSkge1xuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByZWxvYWQpIHtcbiAgICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgbm9ybWFsaXplZFtlbnRyeV0gPSB0cnVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KGVudHJ5KSkge1xuICAgICAgICBtZXJnZVByZWxvYWRSZWNvcmQobm9ybWFsaXplZCwgbm9ybWFsaXplUHJlbG9hZChlbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHByZWxvYWQgZW50cnkgdHlwZTogJHt0eXBlb2YgZW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHByZWxvYWQpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgcHJlbG9hZCB0eXBlOiAke3R5cGVvZiBwcmVsb2FkfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFByZWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWQpKSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IHRydWUgfHwgcmVsYXRpb25zaGlwUHJlbG9hZCA9PT0gZmFsc2UpIHtcbiAgICAgIG5vcm1hbGl6ZWRbcmVsYXRpb25zaGlwTmFtZV0gPSByZWxhdGlvbnNoaXBQcmVsb2FkXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcmVsYXRpb25zaGlwUHJlbG9hZCA9PT0gXCJzdHJpbmdcIiB8fCBBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFByZWxvYWQpIHx8IGlzUGxhaW5PYmplY3QocmVsYXRpb25zaGlwUHJlbG9hZCkpIHtcbiAgICAgIG5vcm1hbGl6ZWRbcmVsYXRpb25zaGlwTmFtZV0gPSBub3JtYWxpemVQcmVsb2FkKHJlbGF0aW9uc2hpcFByZWxvYWQpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHByZWxvYWQgdmFsdWUgZm9yICR7cmVsYXRpb25zaGlwTmFtZX06ICR7dHlwZW9mIHJlbGF0aW9uc2hpcFByZWxvYWR9YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogTm9ybWFsaXplIHRoZSBzaG9ydGhhbmQgYHdpdGhDb3VudGAgYXJndW1lbnQgZnJvbSB0aGUgZnJvbnRlbmQtbW9kZWxcbiAqIHF1ZXJ5IEFQSSBpbnRvIHRoZSBzdHJpY3QgaW50ZXJuYWwgZW50cmllcyB1c2VkIGluIHRoZSB0cmFuc3BvcnRcbiAqIHBheWxvYWQuIFNoYXJlcyB0aGUgc2hhcGUgc2VtYW50aWNzIHdpdGggdGhlIGJhY2tlbmQgbm9ybWFsaXplciBpblxuICogYGRhdGFiYXNlL3F1ZXJ5L3dpdGgtY291bnQuanNgLlxuICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSBzcGVjIC0gQXNzb2NpYXRpb24tY291bnQgc2hvcnRoYW5kIHRvIG5vcm1hbGl6ZS5cbiAqIEByZXR1cm5zIHtBcnJheTx7YXR0cmlidXRlTmFtZTogc3RyaW5nLCByZWxhdGlvbnNoaXBOYW1lOiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gTm9ybWFsaXplZCBhc3NvY2lhdGlvbi1jb3VudCByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplV2l0aENvdW50RnJvbnRlbmQoc3BlYykge1xuICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHNwZWMgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW3thdHRyaWJ1dGVOYW1lOiBgJHtzcGVjfUNvdW50YCwgcmVsYXRpb25zaGlwTmFtZTogc3BlY31dXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzcGVjKSkge1xuICAgIHJldHVybiBzcGVjLmZsYXRNYXAoKGl0ZW0pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgaXRlbSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhDb3VudCBhcnJheSBlbnRyaWVzIG11c3QgYmUgc3RyaW5nczsgZ290ICR7dHlwZW9mIGl0ZW19YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFt7YXR0cmlidXRlTmFtZTogYCR7aXRlbX1Db3VudGAsIHJlbGF0aW9uc2hpcE5hbWU6IGl0ZW19XVxuICAgIH0pXG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3Qoc3BlYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgd2l0aENvdW50IHNwZWM6ICR7dHlwZW9mIHNwZWN9YClcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMpKSB7XG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSB7XG4gICAgICBlbnRyaWVzLnB1c2goe2F0dHJpYnV0ZU5hbWU6IGAke2tleX1Db3VudGAsIHJlbGF0aW9uc2hpcE5hbWU6IGtleX0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIGNvbnRpbnVlXG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSAvKiogQHR5cGUge3tyZWxhdGlvbnNoaXA/OiBzdHJpbmcsIHdoZXJlPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKHZhbHVlKVxuICAgICAgZW50cmllcy5wdXNoKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZToga2V5LFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lOiBvcHRpb25zLnJlbGF0aW9uc2hpcCB8fCBrZXksXG4gICAgICAgIHdoZXJlOiBvcHRpb25zLndoZXJlXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgd2l0aENvdW50IHZhbHVlIGZvciAke2tleX06ICR7dHlwZW9mIHZhbHVlfWApXG4gIH1cblxuICByZXR1cm4gZW50cmllc1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhIGZyb250ZW5kIGAuYWJpbGl0aWVzKC4uLilgIHNwZWMgaW50byBhIGZsYXQgbGlzdCBvZlxuICogYHttb2RlbE5hbWUsIGFjdGlvbnN9YCBlbnRyaWVzLiBBY2NlcHRzIHRoZSBmbGF0IGFjdGlvbnMtYXJyYXlcbiAqIHNob3J0aGFuZCAoYXBwbGllcyB0byB0aGUgcXVlcnkncyBvd24gbW9kZWwgY2xhc3MpIGFuZCB0aGUga2V5ZWRcbiAqIGB7TW9kZWxOYW1lOiBbYWN0aW9uLCAuLi5dfWAgZm9ybSAoYXBwbGllcyB0byByZWNvcmRzIG9mIHRoYXQgbW9kZWxcbiAqIGNsYXNzLCB1c2VmdWwgZm9yIHByZWxvYWRlZCBjaGlsZHJlbikuXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzcGVjIC0gQWJpbGl0eSBhY3Rpb25zIGdyb3VwZWQgYnkgbW9kZWwsIG9yIHJvb3QtbW9kZWwgYWN0aW9uIHNob3J0aGFuZC5cbiAqIEBwYXJhbSB7e2dldE1vZGVsTmFtZTogKCkgPT4gc3RyaW5nfX0gcm9vdE1vZGVsQ2xhc3MgLSBRdWVyeSByb290IHVzZWQgYnkgdGhlIGZsYXQgYWN0aW9uIHNob3J0aGFuZC5cbiAqIEByZXR1cm5zIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59IC0gTm9ybWFsaXplZCBtb2RlbCBhYmlsaXR5IHJlcXVlc3RzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVBYmlsaXRpZXNTcGVjKHNwZWMsIHJvb3RNb2RlbENsYXNzKSB7XG4gIGlmIChzcGVjID09IG51bGwpIHJldHVybiBbXVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHNwZWMpKSB7XG4gICAgZm9yIChjb25zdCBhY3Rpb24gb2Ygc3BlYykge1xuICAgICAgaWYgKHR5cGVvZiBhY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBhYmlsaXRpZXMgZmxhdC1mb3JtIGFjdGlvbnMgbXVzdCBiZSBub24tZW1wdHkgc3RyaW5nczsgZ290ICR7dHlwZW9mIGFjdGlvbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJvb3RNb2RlbE5hbWUgPSByb290TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIGlmICghcm9vdE1vZGVsTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiYWJpbGl0aWVzIGZsYXQtZm9ybSByZXF1aXJlcyBhIHJvb3QgbW9kZWwgY2xhc3Mgd2l0aCBnZXRNb2RlbE5hbWUoKVwiKVxuICAgIH1cblxuICAgIHJldHVybiBbe2FjdGlvbnM6IFsuLi5zcGVjXSwgbW9kZWxOYW1lOiByb290TW9kZWxOYW1lfV1cbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChzcGVjKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhYmlsaXRpZXMgc3BlYzogJHt0eXBlb2Ygc3BlY31gKVxuICB9XG5cbiAgLyoqXG4gICAqIEVudHJpZXMuXG4gICAqIEB0eXBlIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59ICovXG4gIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYWN0aW9uc10gb2YgT2JqZWN0LmVudHJpZXMoc3BlYykpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoYWN0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgYWJpbGl0aWVzWyR7bW9kZWxOYW1lfV0gbXVzdCBiZSBhbiBhcnJheSBvZiBhY3Rpb24gbmFtZXM7IGdvdCAke3R5cGVvZiBhY3Rpb25zfWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2FuaXRpemVkID0gYWN0aW9ucy5tYXAoKGFjdGlvbikgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBhY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBhYmlsaXRpZXNbJHttb2RlbE5hbWV9XSBlbnRyaWVzIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3M7IGdvdCAke3R5cGVvZiBhY3Rpb259YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGlvblxuICAgIH0pXG5cbiAgICBlbnRyaWVzLnB1c2goe2FjdGlvbnM6IHNhbml0aXplZCwgbW9kZWxOYW1lfSlcbiAgfVxuXG4gIHJldHVybiBlbnRyaWVzXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBwcmVsb2FkIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gdGFyZ2V0UHJlbG9hZCAtIEV4aXN0aW5nIHByZWxvYWQgZGF0YS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gaW5jb21pbmdQcmVsb2FkIC0gTmV3IHByZWxvYWQgZGF0YS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVByZWxvYWRSZWNvcmQodGFyZ2V0UHJlbG9hZCwgaW5jb21pbmdQcmVsb2FkKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIGluY29taW5nVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGluY29taW5nUHJlbG9hZCkpIHtcbiAgICBjb25zdCBleGlzdGluZ1ZhbHVlID0gdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKGluY29taW5nVmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICB0YXJnZXRQcmVsb2FkW3JlbGF0aW9uc2hpcE5hbWVdID0gZmFsc2VcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGluY29taW5nVmFsdWUgPT09IHRydWUpIHtcbiAgICAgIGlmIChleGlzdGluZ1ZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IHRydWVcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGluY29taW5nVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJlbG9hZCB2YWx1ZSBmb3IgJHtyZWxhdGlvbnNoaXBOYW1lfTogJHt0eXBlb2YgaW5jb21pbmdWYWx1ZX1gKVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KGV4aXN0aW5nVmFsdWUpKSB7XG4gICAgICBtZXJnZVByZWxvYWRSZWNvcmQoXG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi8gKGV4aXN0aW5nVmFsdWUpLFxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovIChpbmNvbWluZ1ZhbHVlKVxuICAgICAgKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0YXJnZXRQcmVsb2FkW3JlbGF0aW9uc2hpcE5hbWVdID0gbm9ybWFsaXplUHJlbG9hZChpbmNvbWluZ1ZhbHVlKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc2VsZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VsZWN0IC0gU2VsZWN0IHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFtyb290TW9kZWxOYW1lXSAtIE9wdGlvbmFsIHJvb3QgbW9kZWwgbmFtZSBmb3Igc2hvcnRoYW5kIHNlbGVjdCBwYXlsb2Fkcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IC0gTm9ybWFsaXplZCBtb2RlbC1uYW1lIGtleWVkIHNlbGVjdCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNlbGVjdChzZWxlY3QsIHJvb3RNb2RlbE5hbWUgPSBudWxsKSB7XG4gIGlmICghc2VsZWN0KSByZXR1cm4ge31cblxuICBpZiAodHlwZW9mIHNlbGVjdCA9PT0gXCJzdHJpbmdcIikge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzZWxlY3Qgc2hvcnRoYW5kIHdpdGhvdXQgcm9vdCBtb2RlbCBuYW1lXCIpXG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogW3NlbGVjdF19XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgaWYgKCFyb290TW9kZWxOYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHNlbGVjdCBzaG9ydGhhbmQgd2l0aG91dCByb290IG1vZGVsIG5hbWVcIilcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3QpIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IGF0dHJpYnV0ZSBmb3IgJHtyb290TW9kZWxOYW1lfTogJHt0eXBlb2YgYXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7W3Jvb3RNb2RlbE5hbWVdOiBBcnJheS5mcm9tKG5ldyBTZXQoc2VsZWN0KSl9XG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3Qoc2VsZWN0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWxlY3QgdHlwZTogJHt0eXBlb2Ygc2VsZWN0fWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBzZWxlY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKHNlbGVjdCkpIHtcbiAgICBpZiAodHlwZW9mIHNlbGVjdGlvbiA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgbm9ybWFsaXplZFttb2RlbE5hbWVdID0gW3NlbGVjdGlvbl1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNlbGVjdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWxlY3QgdmFsdWUgZm9yICR7bW9kZWxOYW1lfTogJHt0eXBlb2Ygc2VsZWN0aW9ufWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdGlvbikge1xuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWxlY3QgYXR0cmlidXRlIGZvciAke21vZGVsTmFtZX06ICR7dHlwZW9mIGF0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBub3JtYWxpemVkW21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoc2VsZWN0aW9uKSlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBzZWxlY3QgcmVjb3JkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHRhcmdldFNlbGVjdCAtIEV4aXN0aW5nIHNlbGVjdCByZWNvcmQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gaW5jb21pbmdTZWxlY3QgLSBJbmNvbWluZyBzZWxlY3QgcmVjb3JkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlU2VsZWN0UmVjb3JkKHRhcmdldFNlbGVjdCwgaW5jb21pbmdTZWxlY3QpIHtcbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBpbmNvbWluZ0F0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKGluY29taW5nU2VsZWN0KSkge1xuICAgIGNvbnN0IGV4aXN0aW5nQXR0cmlidXRlcyA9IHRhcmdldFNlbGVjdFttb2RlbE5hbWVdIHx8IFtdXG5cbiAgICB0YXJnZXRTZWxlY3RbbW9kZWxOYW1lXSA9IEFycmF5LmZyb20obmV3IFNldChbLi4uZXhpc3RpbmdBdHRyaWJ1dGVzLCAuLi5pbmNvbWluZ0F0dHJpYnV0ZXNdKSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZVNlYXJjaE9wZXJhdG9yIGhlbHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRvciAtIFJhdyBzZWFyY2ggb3BlcmF0b3IuXG4gKiBAcmV0dXJucyB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwifSAtIE5vcm1hbGl6ZWQgb3BlcmF0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTZWFyY2hPcGVyYXRvcihvcGVyYXRvcikge1xuICBjb25zdCBvcGVyYXRvckFsaWFzZXMgPSB7XG4gICAgXCI8XCI6IFwibHRcIixcbiAgICBcIjw9XCI6IFwibHRlcVwiLFxuICAgIFwiPlwiOiBcImd0XCIsXG4gICAgXCI+PVwiOiBcImd0ZXFcIlxuICB9XG4gIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRvciA9IG9wZXJhdG9yQWxpYXNlc1svKiogQHR5cGUge1wiPFwiIHwgXCI8PVwiIHwgXCI+XCIgfCBcIj49XCJ9ICovIChvcGVyYXRvcildIHx8IG9wZXJhdG9yXG4gIGNvbnN0IHN1cHBvcnRlZE9wZXJhdG9ycyA9IG5ldyBTZXQoW1wiZXFcIiwgXCJsaWtlXCIsIFwibm90RXFcIiwgXCJndFwiLCBcImd0ZXFcIiwgXCJsdFwiLCBcImx0ZXFcIl0pXG5cbiAgaWYgKCFzdXBwb3J0ZWRPcGVyYXRvcnMuaGFzKG5vcm1hbGl6ZWRPcGVyYXRvcikpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgc2VhcmNoIG9wZXJhdG9yIG11c3QgYmUgb25lIG9mOiBlcSwgbGlrZSwgbm90RXEsIGd0LCBndGVxLCBsdCwgbHRlcSwgPiwgPj0sIDwsIDw9IChnb3Q6ICR7b3BlcmF0b3J9KWApXG4gIH1cblxuICByZXR1cm4gLyoqIEB0eXBlIHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9ICovIChub3JtYWxpemVkT3BlcmF0b3IpXG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBqb2luIHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB0YXJnZXRKb2lucyAtIEV4aXN0aW5nIGpvaW4gcmVjb3JkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGluY29taW5nSm9pbnMgLSBJbmNvbWluZyBqb2luIHJlY29yZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUpvaW5SZWNvcmQodGFyZ2V0Sm9pbnMsIGluY29taW5nSm9pbnMpIHtcbiAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgaW5jb21pbmdWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaW5jb21pbmdKb2lucykpIHtcbiAgICBjb25zdCBleGlzdGluZ1ZhbHVlID0gdGFyZ2V0Sm9pbnNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmIChpbmNvbWluZ1ZhbHVlID09PSB0cnVlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRhcmdldEpvaW5zW3JlbGF0aW9uc2hpcE5hbWVdID0gdHJ1ZVxuICAgICAgfVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoaW5jb21pbmdWYWx1ZSkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGpvaW4gdmFsdWUgZm9yICR7cmVsYXRpb25zaGlwTmFtZX06ICR7dHlwZW9mIGluY29taW5nVmFsdWV9YClcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChleGlzdGluZ1ZhbHVlKSkge1xuICAgICAgbWVyZ2VKb2luUmVjb3JkKGV4aXN0aW5nVmFsdWUsIGluY29taW5nVmFsdWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChleGlzdGluZ1ZhbHVlID09PSB0cnVlKSB7XG4gICAgICB0YXJnZXRKb2luc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZUpvaW5zKGluY29taW5nVmFsdWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRhcmdldEpvaW5zW3JlbGF0aW9uc2hpcE5hbWVdID0gbm9ybWFsaXplSm9pbnMoaW5jb21pbmdWYWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZUpvaW5zIGhlbHBlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGpvaW5zIC0gSm9pbiBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBOb3JtYWxpemVkIHJlbGF0aW9uc2hpcCBkZXNjcmlwdG9yIGpvaW5zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplSm9pbnMoam9pbnMpIHtcbiAgaWYgKCFqb2lucykgcmV0dXJuIHt9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoam9pbnMpKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBqb2luRW50cnkgb2Ygam9pbnMpIHtcbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChqb2luRW50cnkpKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGpvaW5zIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGpvaW5FbnRyeX1gKVxuICAgICAgfVxuXG4gICAgICBtZXJnZUpvaW5SZWNvcmQobm9ybWFsaXplZCwgbm9ybWFsaXplSm9pbnMoam9pbkVudHJ5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGpvaW5zKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGpvaW5zIHR5cGU6ICR7dHlwZW9mIGpvaW5zfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwSm9pbl0gb2YgT2JqZWN0LmVudHJpZXMoam9pbnMpKSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcEpvaW4gPT09IHRydWUpIHtcbiAgICAgIG5vcm1hbGl6ZWRbcmVsYXRpb25zaGlwTmFtZV0gPSB0cnVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KHJlbGF0aW9uc2hpcEpvaW4pKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gbm9ybWFsaXplSm9pbnMocmVsYXRpb25zaGlwSm9pbilcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgam9pbiBkZWZpbml0aW9uIGZvciBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIjogJHt0eXBlb2YgcmVsYXRpb25zaGlwSm9pbn1gKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBzb3J0IGRpcmVjdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGRpcmVjdGlvbiAtIERpcmVjdGlvbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtcImFzY1wiIHwgXCJkZXNjXCJ9IC0gTm9ybWFsaXplZCBkaXJlY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oZGlyZWN0aW9uKSB7XG4gIGlmICh0eXBlb2YgZGlyZWN0aW9uICE9PSBcInN0cmluZ1wiKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkaXJlY3Rpb24gdHlwZTogJHt0eXBlb2YgZGlyZWN0aW9ufWApXG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkRGlyZWN0aW9uID0gZGlyZWN0aW9uLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgaWYgKG5vcm1hbGl6ZWREaXJlY3Rpb24gIT09IFwiYXNjXCIgJiYgbm9ybWFsaXplZERpcmVjdGlvbiAhPT0gXCJkZXNjXCIpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRpcmVjdGlvbjogJHtkaXJlY3Rpb259YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkRGlyZWN0aW9uXG59XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIHZhbHVlIGlzIGEgdHdvLWl0ZW0gYFtjb2x1bW4sIGRpcmVjdGlvbl1gIHNvcnQgdHVwbGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB0dXBsZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBbc3RyaW5nLCBzdHJpbmddfSAtIFdoZXRoZXIgdmFsdWUgaXMgYSBzb3J0IHR1cGxlLlxuICovXG5mdW5jdGlvbiBzb3J0VHVwbGUodmFsdWUpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmICh2YWx1ZS5sZW5ndGggIT09IDIpIHJldHVybiBmYWxzZVxuICBpZiAodHlwZW9mIHZhbHVlWzBdICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZVsxXSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG4gIGlmICh2YWx1ZVswXS50cmltKCkubGVuZ3RoIDwgMSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgZGlyZWN0aW9uID0gdmFsdWVbMV0udHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICByZXR1cm4gZGlyZWN0aW9uID09PSBcImFzY1wiIHx8IGRpcmVjdGlvbiA9PT0gXCJkZXNjXCJcbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgdmFsdWUgaXMgYSBzdHJ1Y3R1cmVkIHNvcnQgZGVzY3JpcHRvciB3aXRoIGEgcmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBkZXNjcmlwdG9yLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHtjb2x1bW46IHN0cmluZywgZGlyZWN0aW9uOiBzdHJpbmcsIHBhdGg6IHN0cmluZ1tdfX0gLSBXaGV0aGVyIHZhbHVlIGlzIGFuIGV4cGxpY2l0IHNvcnQgZGVzY3JpcHRvciBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHNvcnREZXNjcmlwdG9yKHZhbHVlKSB7XG4gIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuICBpZiAoIShcImNvbHVtblwiIGluIHZhbHVlKSB8fCAhKFwiZGlyZWN0aW9uXCIgaW4gdmFsdWUpIHx8ICEoXCJwYXRoXCIgaW4gdmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb2x1bW4gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAodHlwZW9mIHZhbHVlLmRpcmVjdGlvbiAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZS5wYXRoKSkgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIHZhbHVlLnBhdGguZXZlcnkoKHBhdGhFbnRyeSkgPT4gdHlwZW9mIHBhdGhFbnRyeSA9PT0gXCJzdHJpbmdcIilcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHN0cmluZyBzaG9ydGhhbmQgaW50byBhIHNvcnQgZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3J0VmFsdWUgLSBTb3J0IHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0fSAtIE5vcm1hbGl6ZWQgc29ydCBkZXNjcmlwdG9yLlxuICovXG5mdW5jdGlvbiBwYXJzZVNvcnRTdHJpbmcoc29ydFZhbHVlLCBwYXRoID0gW10pIHtcbiAgY29uc3QgdHJpbW1lZCA9IHNvcnRWYWx1ZS50cmltKClcblxuICBpZiAodHJpbW1lZC5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJzb3J0IHZhbHVlIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG4gIH1cblxuICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiLVwiKSkge1xuICAgIGNvbnN0IGNvbHVtbiA9IHRyaW1tZWQuc2xpY2UoMSkudHJpbSgpXG5cbiAgICBpZiAoY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGVmaW5pdGlvbjogJHtzb3J0VmFsdWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY29sdW1uLFxuICAgICAgZGlyZWN0aW9uOiBcImRlc2NcIixcbiAgICAgIHBhdGg6IFsuLi5wYXRoXVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHNvcnRQYXJ0cyA9IHRyaW1tZWQuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbilcblxuICBpZiAoc29ydFBhcnRzLmxlbmd0aCA+IDIpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb246ICR7c29ydFZhbHVlfWApXG4gIH1cblxuICBjb25zdCBjb2x1bW4gPSBzb3J0UGFydHNbMF1cblxuICBpZiAoY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb246ICR7c29ydFZhbHVlfWApXG4gIH1cblxuICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0UGFydHMubGVuZ3RoID09PSAyXG4gICAgPyBub3JtYWxpemVTb3J0RGlyZWN0aW9uKHNvcnRQYXJ0c1sxXSlcbiAgICA6IFwiYXNjXCJcblxuICByZXR1cm4ge1xuICAgIGNvbHVtbixcbiAgICBkaXJlY3Rpb24sXG4gICAgcGF0aDogWy4uLnBhdGhdXG4gIH1cbn1cblxuLyoqXG4gKiBQYXJzZSBhIHR1cGxlIHNob3J0aGFuZCBpbnRvIGEgc29ydCBkZXNjcmlwdG9yLlxuICogQHBhcmFtIHtbc3RyaW5nLCBzdHJpbmddfSBzb3J0VmFsdWUgLSBTb3J0IHR1cGxlLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gW3BhdGhdIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNvcnR9IC0gTm9ybWFsaXplZCBzb3J0IGRlc2NyaXB0b3IuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlU29ydFR1cGxlKHNvcnRWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IFtjb2x1bW5WYWx1ZSwgZGlyZWN0aW9uVmFsdWVdID0gc29ydFZhbHVlXG4gIGNvbnN0IGNvbHVtbiA9IGNvbHVtblZhbHVlLnRyaW0oKVxuXG4gIGlmIChjb2x1bW4ubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwic29ydCB0dXBsZSBjb2x1bW4gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY29sdW1uLFxuICAgIGRpcmVjdGlvbjogbm9ybWFsaXplU29ydERpcmVjdGlvbihkaXJlY3Rpb25WYWx1ZSksXG4gICAgcGF0aDogWy4uLnBhdGhdXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSBuZXN0ZWQgb2JqZWN0IHNvcnQgcGF5bG9hZCBpbnRvIGZsYXQgc29ydCBkZXNjcmlwdG9ycy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBzb3J0VmFsdWUgLSBOZXN0ZWQgc29ydCBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gLSBOb3JtYWxpemVkIHNvcnQgZGVzY3JpcHRvcnMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNvcnRPYmplY3Qoc29ydFZhbHVlLCBwYXRoKSB7XG4gIC8qKlxuICAgKiBOb3JtYWxpemVkIHNvcnRzLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZFNvcnRzID0gW11cblxuICBmb3IgKGNvbnN0IFtzb3J0S2V5LCBzb3J0RW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHNvcnRWYWx1ZSkpIHtcbiAgICBpZiAodHlwZW9mIHNvcnRFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgbm9ybWFsaXplZFNvcnRzLnB1c2goe1xuICAgICAgICBjb2x1bW46IHNvcnRLZXksXG4gICAgICAgIGRpcmVjdGlvbjogbm9ybWFsaXplU29ydERpcmVjdGlvbihzb3J0RW50cnkpLFxuICAgICAgICBwYXRoOiBbLi4ucGF0aF1cbiAgICAgIH0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChzb3J0VHVwbGUoc29ydEVudHJ5KSkge1xuICAgICAgbm9ybWFsaXplZFNvcnRzLnB1c2gocGFyc2VTb3J0VHVwbGUoc29ydEVudHJ5LCBbLi4ucGF0aCwgc29ydEtleV0pKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShzb3J0RW50cnkpKSB7XG4gICAgICBpZiAoc29ydEVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkZWZpbml0aW9uIGZvciBcIiR7c29ydEtleX1cIjogZW1wdHkgYXJyYXlgKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZFNvcnRFbnRyeSBvZiBzb3J0RW50cnkpIHtcbiAgICAgICAgaWYgKCFzb3J0VHVwbGUobmVzdGVkU29ydEVudHJ5KSkge1xuICAgICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGVmaW5pdGlvbiBmb3IgXCIke3NvcnRLZXl9XCI6IGV4cGVjdGVkIFtjb2x1bW4sIGRpcmVjdGlvbl0gdHVwbGVzYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKHBhcnNlU29ydFR1cGxlKG5lc3RlZFNvcnRFbnRyeSwgWy4uLnBhdGgsIHNvcnRLZXldKSlcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3Qoc29ydEVudHJ5KSkge1xuICAgICAgbm9ybWFsaXplZFNvcnRzLnB1c2goLi4ubm9ybWFsaXplU29ydE9iamVjdChzb3J0RW50cnksIFsuLi5wYXRoLCBzb3J0S2V5XSkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGVmaW5pdGlvbiBmb3IgXCIke3NvcnRLZXl9XCI6ICR7dHlwZW9mIHNvcnRFbnRyeX1gKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRTb3J0c1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhbnkgc3VwcG9ydGVkIHNvcnQgcGF5bG9hZCBpbnRvIGZsYXQgc29ydCBkZXNjcmlwdG9ycy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNvcnQgLSBTb3J0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gLSBOb3JtYWxpemVkIHNvcnQgZGVmaW5pdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVTb3J0KHNvcnQpIHtcbiAgaWYgKCFzb3J0KSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHNvcnQgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW3BhcnNlU29ydFN0cmluZyhzb3J0KV1cbiAgfVxuXG4gIGlmIChzb3J0VHVwbGUoc29ydCkpIHtcbiAgICByZXR1cm4gW3BhcnNlU29ydFR1cGxlKHNvcnQpXVxuICB9XG5cbiAgaWYgKHNvcnREZXNjcmlwdG9yKHNvcnQpKSB7XG4gICAgcmV0dXJuIFt7XG4gICAgICBjb2x1bW46IHNvcnQuY29sdW1uLnRyaW0oKSxcbiAgICAgIGRpcmVjdGlvbjogbm9ybWFsaXplU29ydERpcmVjdGlvbihzb3J0LmRpcmVjdGlvbiksXG4gICAgICBwYXRoOiBbLi4uc29ydC5wYXRoXVxuICAgIH1dXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdChzb3J0KSkge1xuICAgIHJldHVybiBub3JtYWxpemVTb3J0T2JqZWN0KHNvcnQsIFtdKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc29ydCkpIHtcbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVkLlxuICAgICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsU29ydFtdfSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzb3J0RW50cnkgb2Ygc29ydCkge1xuICAgICAgaWYgKHR5cGVvZiBzb3J0RW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHBhcnNlU29ydFN0cmluZyhzb3J0RW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoc29ydFR1cGxlKHNvcnRFbnRyeSkpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHBhcnNlU29ydFR1cGxlKHNvcnRFbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChzb3J0RGVzY3JpcHRvcihzb3J0RW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICAgICAgY29sdW1uOiBzb3J0RW50cnkuY29sdW1uLnRyaW0oKSxcbiAgICAgICAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oc29ydEVudHJ5LmRpcmVjdGlvbiksXG4gICAgICAgICAgcGF0aDogWy4uLnNvcnRFbnRyeS5wYXRoXVxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChzb3J0RW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCguLi5ub3JtYWxpemVTb3J0T2JqZWN0KHNvcnRFbnRyeSwgW10pKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGVudHJ5IHR5cGU6ICR7dHlwZW9mIHNvcnRFbnRyeX1gKVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IHR5cGU6ICR7dHlwZW9mIHNvcnR9YClcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHN0cmluZyBzaG9ydGhhbmQgaW50byBhIGdyb3VwIGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXBWYWx1ZSAtIEdyb3VwIHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxHcm91cH0gLSBOb3JtYWxpemVkIGdyb3VwIGRlc2NyaXB0b3IuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlR3JvdXBTdHJpbmcoZ3JvdXBWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBncm91cFZhbHVlLnRyaW0oKVxuXG4gIGlmICghL15bYS16QS1aX11bYS16QS1aMC05X10qJC8udGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGdyb3VwIGNvbHVtbjogJHtncm91cFZhbHVlfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvbHVtbjogdHJpbW1lZCxcbiAgICBwYXRoOiBbLi4ucGF0aF1cbiAgfVxufVxuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgYSB2YWx1ZSBpcyBhIHN0cnVjdHVyZWQgY29sdW1uL3BhdGggZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGRlc2NyaXB0b3IuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMge2NvbHVtbjogc3RyaW5nLCBwYXRoOiBzdHJpbmdbXX19IC0gV2hldGhlciBjYW5kaWRhdGUgaXMgYW4gZXhwbGljaXQgY29sdW1uIGRlc2NyaXB0b3Igb2JqZWN0LlxuICovXG5mdW5jdGlvbiBjb2x1bW5QYXRoRGVzY3JpcHRvcih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKCEoXCJjb2x1bW5cIiBpbiB2YWx1ZSkgfHwgIShcInBhdGhcIiBpbiB2YWx1ZSkpIHJldHVybiBmYWxzZVxuICBpZiAodHlwZW9mIHZhbHVlLmNvbHVtbiAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZS5wYXRoKSkgcmV0dXJuIGZhbHNlXG5cbiAgcmV0dXJuIHZhbHVlLnBhdGguZXZlcnkoKHBhdGhFbnRyeSkgPT4gdHlwZW9mIHBhdGhFbnRyeSA9PT0gXCJzdHJpbmdcIilcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSBuZXN0ZWQgb2JqZWN0IGNvbHVtbiBwcm9qZWN0aW9uIHBheWxvYWQgaW50byBmbGF0IGRlc2NyaXB0b3JzLlxuICogQHRlbXBsYXRlIHt7Y29sdW1uOiBzdHJpbmcsIHBhdGg6IHN0cmluZ1tdfX0gVFxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHZhbHVlIC0gTmVzdGVkIHByb2plY3Rpb24gb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHBhcmFtIHsoY29sdW1uVmFsdWU6IHN0cmluZywgcGF0aD86IHN0cmluZ1tdKSA9PiBUfSBwYXJzZVN0cmluZyAtIFN0cmluZyBwcm9qZWN0aW9uIHBhcnNlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIFByb2plY3Rpb24gbGFiZWwgZm9yIGVycm9ycy5cbiAqIEByZXR1cm5zIHtUW119IC0gTm9ybWFsaXplZCBwcm9qZWN0aW9uIGRlc2NyaXB0b3JzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KHZhbHVlLCBwYXRoLCBwYXJzZVN0cmluZywgbGFiZWwpIHtcbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtUW119ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gIGZvciAoY29uc3QgW3Byb2plY3Rpb25LZXksIHByb2plY3Rpb25FbnRyeV0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgaWYgKHR5cGVvZiBwcm9qZWN0aW9uRW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVN0cmluZyhwcm9qZWN0aW9uRW50cnksIFsuLi5wYXRoLCBwcm9qZWN0aW9uS2V5XSkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByb2plY3Rpb25FbnRyeSkpIHtcbiAgICAgIGlmIChwcm9qZWN0aW9uRW50cnkubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCAke2xhYmVsfSBkZWZpbml0aW9uIGZvciBcIiR7cHJvamVjdGlvbktleX1cIjogZW1wdHkgYXJyYXlgKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZFByb2plY3Rpb25FbnRyeSBvZiBwcm9qZWN0aW9uRW50cnkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBuZXN0ZWRQcm9qZWN0aW9uRW50cnkgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCAke2xhYmVsfSBkZWZpbml0aW9uIGZvciBcIiR7cHJvamVjdGlvbktleX1cIjogZXhwZWN0ZWQgc3RyaW5nIGNvbHVtbnNgKVxuICAgICAgICB9XG5cbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHBhcnNlU3RyaW5nKG5lc3RlZFByb2plY3Rpb25FbnRyeSwgWy4uLnBhdGgsIHByb2plY3Rpb25LZXldKSlcbiAgICAgIH1cblxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChwcm9qZWN0aW9uRW50cnkpKSB7XG4gICAgICBub3JtYWxpemVkLnB1c2goLi4ubm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdChwcm9qZWN0aW9uRW50cnksIFsuLi5wYXRoLCBwcm9qZWN0aW9uS2V5XSwgcGFyc2VTdHJpbmcsIGxhYmVsKSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtsYWJlbH0gZGVmaW5pdGlvbiBmb3IgXCIke3Byb2plY3Rpb25LZXl9XCI6ICR7dHlwZW9mIHByb2plY3Rpb25FbnRyeX1gKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYW55IHN1cHBvcnRlZCBncm91cCBwYXlsb2FkIGludG8gZmxhdCBncm91cCBkZXNjcmlwdG9ycy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGdyb3VwIC0gR3JvdXAgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsR3JvdXBbXX0gLSBOb3JtYWxpemVkIGdyb3VwIGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplR3JvdXAoZ3JvdXApIHtcbiAgaWYgKCFncm91cCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBncm91cCA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiBbcGFyc2VHcm91cFN0cmluZyhncm91cCldXG4gIH1cblxuICBpZiAoY29sdW1uUGF0aERlc2NyaXB0b3IoZ3JvdXApKSB7XG4gICAgcmV0dXJuIFt7XG4gICAgICBjb2x1bW46IHBhcnNlR3JvdXBTdHJpbmcoZ3JvdXAuY29sdW1uKS5jb2x1bW4sXG4gICAgICBwYXRoOiBbLi4uZ3JvdXAucGF0aF1cbiAgICB9XVxuICB9XG5cbiAgaWYgKGlzUGxhaW5PYmplY3QoZ3JvdXApKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QoZ3JvdXAsIFtdLCBwYXJzZUdyb3VwU3RyaW5nLCBcImdyb3VwXCIpXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShncm91cCkpIHtcbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVkLlxuICAgICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsR3JvdXBbXX0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICAgIGZvciAoY29uc3QgZ3JvdXBFbnRyeSBvZiBncm91cCkge1xuICAgICAgaWYgKHR5cGVvZiBncm91cEVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZUdyb3VwU3RyaW5nKGdyb3VwRW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY29sdW1uUGF0aERlc2NyaXB0b3IoZ3JvdXBFbnRyeSkpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHtcbiAgICAgICAgICBjb2x1bW46IHBhcnNlR3JvdXBTdHJpbmcoZ3JvdXBFbnRyeS5jb2x1bW4pLmNvbHVtbixcbiAgICAgICAgICBwYXRoOiBbLi4uZ3JvdXBFbnRyeS5wYXRoXVxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChncm91cEVudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goLi4ubm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdChncm91cEVudHJ5LCBbXSwgcGFyc2VHcm91cFN0cmluZywgXCJncm91cFwiKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgZ3JvdXAgZW50cnkgdHlwZTogJHt0eXBlb2YgZ3JvdXBFbnRyeX1gKVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBncm91cCB0eXBlOiAke3R5cGVvZiBncm91cH1gKVxufVxuXG4vKipcbiAqIFBhcnNlIGEgc3RyaW5nIHNob3J0aGFuZCBpbnRvIGEgcGx1Y2sgZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwbHVja1ZhbHVlIC0gUGx1Y2sgc3RyaW5nLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gW3BhdGhdIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBsdWNrfSAtIE5vcm1hbGl6ZWQgcGx1Y2sgZGVzY3JpcHRvci5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQbHVja1N0cmluZyhwbHVja1ZhbHVlLCBwYXRoID0gW10pIHtcbiAgY29uc3QgdHJpbW1lZCA9IHBsdWNrVmFsdWUudHJpbSgpXG5cbiAgaWYgKCEvXlthLXpBLVpfXVthLXpBLVowLTlfXSokLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgcGx1Y2sgY29sdW1uOiAke3BsdWNrVmFsdWV9YClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY29sdW1uOiB0cmltbWVkLFxuICAgIHBhdGg6IFsuLi5wYXRoXVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGFueSBzdXBwb3J0ZWQgcGx1Y2sgcGF5bG9hZCBpbnRvIGZsYXQgcGx1Y2sgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwbHVjayAtIFBsdWNrIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBsdWNrW119IC0gTm9ybWFsaXplZCBwbHVjayBkZWZpbml0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVBsdWNrKHBsdWNrKSB7XG4gIGlmICghcGx1Y2spIHJldHVybiBbXVxuXG4gIGlmICh0eXBlb2YgcGx1Y2sgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW3BhcnNlUGx1Y2tTdHJpbmcocGx1Y2spXVxuICB9XG5cbiAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKHBsdWNrKSkge1xuICAgIHJldHVybiBbe1xuICAgICAgY29sdW1uOiBwYXJzZVBsdWNrU3RyaW5nKHBsdWNrLmNvbHVtbikuY29sdW1uLFxuICAgICAgcGF0aDogWy4uLnBsdWNrLnBhdGhdXG4gICAgfV1cbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KHBsdWNrKSkge1xuICAgIHJldHVybiBub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KHBsdWNrLCBbXSwgcGFyc2VQbHVja1N0cmluZywgXCJwbHVja1wiKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocGx1Y2spKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFBsdWNrW119ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHBsdWNrRW50cnkgb2YgcGx1Y2spIHtcbiAgICAgIGlmICh0eXBlb2YgcGx1Y2tFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBub3JtYWxpemVkLnB1c2gocGFyc2VQbHVja1N0cmluZyhwbHVja0VudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKHBsdWNrRW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICAgICAgY29sdW1uOiBwYXJzZVBsdWNrU3RyaW5nKHBsdWNrRW50cnkuY29sdW1uKS5jb2x1bW4sXG4gICAgICAgICAgcGF0aDogWy4uLnBsdWNrRW50cnkucGF0aF1cbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QocGx1Y2tFbnRyeSkpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKC4uLm5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QocGx1Y2tFbnRyeSwgW10sIHBhcnNlUGx1Y2tTdHJpbmcsIFwicGx1Y2tcIikpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHBsdWNrIGVudHJ5IHR5cGU6ICR7dHlwZW9mIHBsdWNrRW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgcGx1Y2sgdHlwZTogJHt0eXBlb2YgcGx1Y2t9YClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBSZXNvdXJjZSBhdHRyaWJ1dGUgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZXMobW9kZWxDbGFzcykge1xuICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpKVxuICBjb25zdCBhdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuYXR0cmlidXRlc1xuXG4gIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlcylcbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXMpKSB7XG4gICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gIH1cblxuICByZXR1cm4gbmV3IFNldCgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBwbHVjayB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzIGZvciBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUGx1Y2tUYXJnZXRNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIHBhdGgpIHtcbiAgbGV0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG5cbiAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHBhdGgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcyA9IHRhcmdldE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gcmVsYXRpb25zaGlwRGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICBjb25zdCByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzID0gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBNb2RlbENsYXNzZXNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwbHVjayByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRNb2RlbENsYXNzXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgcGx1Y2sgZGVmaW5pdGlvbnMgYWxsb3dlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGx1Y2sgYXNzZXJ0aW9uIGFyZ3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IGFyZ3MubW9kZWxDbGFzcyAtIFJvb3QgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQbHVja1tdfSBhcmdzLnBsdWNrIC0gUGx1Y2sgZGVzY3JpcHRvcnMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBsdWNrW119IC0gQWxsb3dlZCBwbHVjayBkZXNjcmlwdG9ycy5cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0UGx1Y2tEZWZpbml0aW9uc0FsbG93ZWQoe21vZGVsQ2xhc3MsIHBsdWNrfSkge1xuICByZXR1cm4gcGx1Y2subWFwKChwbHVja0VudHJ5KSA9PiB7XG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxQbHVja1RhcmdldE1vZGVsQ2xhc3MobW9kZWxDbGFzcywgcGx1Y2tFbnRyeS5wYXRoKVxuICAgIGNvbnN0IHRhcmdldEF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVzKHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIXRhcmdldEF0dHJpYnV0ZXMuaGFzKHBsdWNrRW50cnkuY29sdW1uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHBsdWNrIGNvbHVtbiBcIiR7cGx1Y2tFbnRyeS5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbHVtbjogcGx1Y2tFbnRyeS5jb2x1bW4sXG4gICAgICBwYXRoOiBbLi4ucGx1Y2tFbnRyeS5wYXRoXVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIHNlcmlhbGl6ZSBmaW5kIGNvbmRpdGlvbnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTZXJpYWxpemVkIGNvbmRpdGlvbnMgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICovXG5mdW5jdGlvbiBzZXJpYWxpemVGaW5kQ29uZGl0aW9ucyhjb25kaXRpb25zKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGNvbmRpdGlvbnMpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBcIlt1bnNlcmlhbGl6YWJsZSBjb25kaXRpb25zXVwiXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBpbnRlZ2VyIGFyZ3VtZW50LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgaW50ZWdlciB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmd1bWVudE5hbWUgLSBBcmd1bWVudCBuYW1lIGZvciBlcnJvcnMuXG4gKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIEludGVnZXIgb3B0aW9ucy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBvcHRpb25zLm1pbiAtIE1pbmltdW0gYWxsb3dlZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTm9ybWFsaXplZCBpbnRlZ2VyIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQodmFsdWUsIGFyZ3VtZW50TmFtZSwge21pbn0pIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7YXJndW1lbnROYW1lfSBtdXN0IGJlIGFuIGludGVnZXIgbnVtYmVyYClcbiAgfVxuXG4gIGlmICh2YWx1ZSA8IG1pbikge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHthcmd1bWVudE5hbWV9IG11c3QgYmUgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvICR7bWlufWApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBSdW5zIHJldmVyc2Ugc29ydCBkaXJlY3Rpb24uXG4gKiBAcGFyYW0ge1wiYXNjXCIgfCBcImRlc2NcIn0gZGlyZWN0aW9uIC0gQ3VycmVudCBzb3J0IGRpcmVjdGlvbi5cbiAqIEByZXR1cm5zIHtcImFzY1wiIHwgXCJkZXNjXCJ9IC0gUmV2ZXJzZWQgZGlyZWN0aW9uLlxuICovXG5mdW5jdGlvbiByZXZlcnNlU29ydERpcmVjdGlvbihkaXJlY3Rpb24pIHtcbiAgcmV0dXJuIGRpcmVjdGlvbiA9PT0gXCJhc2NcIiA/IFwiZGVzY1wiIDogXCJhc2NcIlxufVxuXG4vKipcbiAqIFF1ZXJ5IHdyYXBwZXIgZm9yIGZyb250ZW5kIG1vZGVsIGNvbW1hbmRzLlxuICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxRdWVyeSB7XG4gIC8qKlxuICAgKiBSYW5zYWNrLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W119ICovXG4gIF9yYW5zYWNrID0gW11cbiAgLyoqXG4gICAqIFNlYXJjaGVzLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqL1xuICBfc2VhcmNoZXMgPSBbXVxuICAvKipcbiAgICogU29ydC5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTb3J0W119ICovXG4gIF9zb3J0ID0gW11cbiAgLyoqXG4gICAqIEdyb3VwLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEdyb3VwW119ICovXG4gIF9ncm91cCA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJncy5cbiAgICogQHBhcmFtIHtUfSBhcmdzLm1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSBbYXJncy5wcmVsb2FkXSAtIFByZWxvYWQgbWFwLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe21vZGVsQ2xhc3MsIHByZWxvYWQgPSB7fX0pIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZCA9IG5vcm1hbGl6ZVByZWxvYWQocHJlbG9hZClcbiAgICB0aGlzLl9qb2lucyA9IHt9XG4gICAgdGhpcy5fd2hlcmUgPSB7fVxuICAgIHRoaXMuX3NlYXJjaGVzID0gW11cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgICB0aGlzLl9zZWxlY3QgPSB7fVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICAgIHRoaXMuX3NlbGVjdHNFeHRyYSA9IHt9XG4gICAgdGhpcy5fc29ydCA9IFtdXG4gICAgdGhpcy5fZ3JvdXAgPSBbXVxuICAgIHRoaXMuX2Rpc3RpbmN0ID0gZmFsc2VcbiAgICB0aGlzLl9saW1pdCA9IG51bGxcbiAgICB0aGlzLl9vZmZzZXQgPSBudWxsXG4gICAgdGhpcy5fcGFnZSA9IG51bGxcbiAgICB0aGlzLl9wZXJQYWdlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgIHRoaXMuX3dpdGhDb3VudCA9IFtdXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIHRoaXMuX3F1ZXJ5RGF0YSA9IFtdXG4gICAgLyoqXG4gICAgICogUGVyLXJlY29yZCBhYmlsaXR5IHNwZWMuIE5vcm1hbGl6ZWQgdG8gYSBsaXN0IG9mXG4gICAgICogYHttb2RlbE5hbWUsIGFjdGlvbnN9YCBlbnRyaWVzIOKAlCBvbmUgZW50cnkgcGVyIG1vZGVsIHRoYXQgc2hvdWxkXG4gICAgICogaGF2ZSBhYmlsaXR5IHJlc3VsdHMgYXR0YWNoZWQuIFRoZSByb290IHF1ZXJ5J3MgbW9kZWwgY2xhc3NcbiAgICAgKiBuYW1lIGlzIGltcGxpY2l0IHZpYSBgXCJfX3Jvb3RfX1wiYCB3aGVuIHRoZSBjYWxsZXIgdXNlZCB0aGUgZmxhdFxuICAgICAqIGFycmF5IGZvcm0uXG4gICAgICogQHR5cGUge0FycmF5PHttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119Pn1cbiAgICAgKi9cbiAgICB0aGlzLl9hYmlsaXRpZXMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFRlbGwgdGhlIGJhY2tlbmQgdG8gZXZhbHVhdGUgb25lIG9yIG1vcmUgYWJpbGl0eSBhY3Rpb25zIGFnYWluc3RcbiAgICogZWFjaCByZXR1cm5lZCByZWNvcmQgKGFuZCBpdHMgcHJlbG9hZGVkIHJlbGF0aW9ucywgd2hlbiBrZXllZCBieVxuICAgKiBtb2RlbCBuYW1lKSBhbmQgc2hpcCB0aGUgcmVzdWx0cyBiYWNrIHNvIHRoZSBmcm9udGVuZCBjYW4gcmVhZFxuICAgKiB0aGVtIHZpYSBgcmVjb3JkLmNhbihhY3Rpb24pYC5cbiAgICpcbiAgICogRmxhdCBmb3JtIOKAlCBhcHBsaWVzIHRvIHRoZSBxdWVyeSdzIG93biBtb2RlbCBjbGFzczpcbiAgICogICBgYGBcbiAgICogICBjb25zdCB0aW1lbG9ncyA9IGF3YWl0IFRpbWVsb2cud2hlcmUoe3Rhc2tJZH0pXG4gICAqICAgICAuYWJpbGl0aWVzKFtcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl0pXG4gICAqICAgICAudG9BcnJheSgpXG4gICAqICAgdGltZWxvZ3NbMF0uY2FuKFwidXBkYXRlXCIpIC8vIOKGkiBib29sZWFuXG4gICAqICAgYGBgXG4gICAqXG4gICAqIEtleWVkIGZvcm0g4oCUIHRhcmdldHMgcmVjb3JkcyBieSBtb2RlbCBuYW1lLCB1c2VmdWwgZm9yIHByZWxvYWRlZFxuICAgKiBjaGlsZHJlbjpcbiAgICogICBgYGBcbiAgICogICBjb25zdCBwcm9qZWN0ID0gYXdhaXQgUHJvamVjdFxuICAgKiAgICAgLnByZWxvYWQoXCJ0aW1lbG9nc1wiKVxuICAgKiAgICAgLmFiaWxpdGllcyh7VGltZWxvZzogW1widXBkYXRlXCIsIFwiZGVzdHJveVwiXX0pXG4gICAqICAgICAuZmlyc3QoKVxuICAgKiAgIHByb2plY3QudGltZWxvZ3MoKS5sb2FkZWQoKVswXS5jYW4oXCJ1cGRhdGVcIikgLy8g4oaSIGJvb2xlYW5cbiAgICogICBgYGBcbiAgICpcbiAgICogS2V5cyBpbiB0aGUga2V5ZWQgZm9ybSBhcmUgdGhlIGJhY2tlbmQgbW9kZWwgbmFtZXMgKGFzIHJldHVybmVkIGJ5XG4gICAqIGBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpYCAvIHRoZSBgbW9kZWxOYW1lYCBmaWVsZCBvZiB0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgY29uZmlnKS4gVmFsdWVzIGFyZSB0aGUgYWJpbGl0eS1hY3Rpb25cbiAgICogc3RyaW5ncyDigJQgdHlwaWNhbGx5IGBcInVwZGF0ZVwiYCAvIGBcImRlc3Ryb3lcImAgLyBgXCJjcmVhdGVcImAgL1xuICAgKiBgXCJyZWFkXCJgLCBidXQgYW55IGN1c3RvbSBhY3Rpb24gcmVnaXN0ZXJlZCBvbiB0aGUgcmVzb3VyY2Unc1xuICAgKiBhdXRob3JpemF0aW9uIGFiaWxpdHkgaXMgYWNjZXB0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHNwZWMgLSBBYmlsaXR5IGFjdGlvbnMgdG8gcmVxdWVzdCBmb3Igcm9vdCBvciBuYW1lZCBtb2RlbHMuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnkgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgYWJpbGl0aWVzKHNwZWMpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZUFiaWxpdGllc1NwZWMoc3BlYywgdGhpcy5tb2RlbENsYXNzKSkge1xuICAgICAgdGhpcy5fbWVyZ2VBYmlsaXR5RW50cnkoZW50cnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lcmdlIGFiaWxpdHkgZW50cnkuXG4gICAqIEBwYXJhbSB7e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX19IGVudHJ5IC0gTm9ybWFsaXplZCBtb2RlbCBhYmlsaXR5IHJlcXVlc3QgdG8gYXBwZW5kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9tZXJnZUFiaWxpdHlFbnRyeShlbnRyeSkge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5fYWJpbGl0aWVzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLm1vZGVsTmFtZSA9PT0gZW50cnkubW9kZWxOYW1lKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhpcy5fYWJpbGl0aWVzLnB1c2goe2FjdGlvbnM6IFsuLi5lbnRyeS5hY3Rpb25zXSwgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWV9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhY3Rpb24gb2YgZW50cnkuYWN0aW9ucykge1xuICAgICAgaWYgKCFleGlzdGluZy5hY3Rpb25zLmluY2x1ZGVzKGFjdGlvbikpIGV4aXN0aW5nLmFjdGlvbnMucHVzaChhY3Rpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlbGwgdGhlIGJhY2tlbmQgaW5kZXggcXVlcnkgdG8gYXR0YWNoIG9uZSBvciBtb3JlIGFzc29jaWF0aW9uXG4gICAqIGNvdW50cyB0byBlYWNoIHJldHVybmVkIHJlY29yZC4gUGFyc2VzIHRoZSBzYW1lIHNoYXBlcyBhcyB0aGVcbiAgICogYmFja2VuZCBgTW9kZWxDbGFzc1F1ZXJ5I3dpdGhDb3VudGAsIHRoZW4gc2hpcHMgdGhlIG5vcm1hbGl6ZWRcbiAgICogZW50cmllcyBhcyBwYXJ0IG9mIHRoZSBgaW5kZXhgIGNvbW1hbmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSBzcGVjIC0gUmVsYXRpb25zaGlwcyB3aG9zZSBjb3VudHMgc2hvdWxkIGJlIHNlcmlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnkgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgd2l0aENvdW50KHNwZWMpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZVdpdGhDb3VudEZyb250ZW5kKHNwZWMpKSB7XG4gICAgICB0aGlzLl93aXRoQ291bnQucHVzaChlbnRyeSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVlc3Qgb25lIG9yIG1vcmUgYmFja2VuZCBxdWVyeURhdGEgZW50cmllcyBmb3IgZWFjaCByZXR1cm5lZFxuICAgKiByZWNvcmQuIFRoZSBzcGVjIGlzIGEgbmFtZSBvciBuZXN0ZWQtcmVjb3JkIHNoYXBlIG1hdGNoaW5nIHRoZVxuICAgKiBgTW9kZWwucXVlcnlEYXRhKG5hbWUsIGZuKWAgcmVnaXN0cmF0aW9ucyBvbiB0aGUgYmFja2VuZCDigJQgdGhlXG4gICAqIGZyb250ZW5kIHNoaXBzIG9ubHkgdGhlc2UgbmFtZXM7IHRoZSBTUUwgZnJhZ21lbnRzIHN0YXkgc2VydmVyLVxuICAgKiBzaWRlLiBBbGwgcmVzdWx0aW5nIGFsaWFzZXMgYXJlIGF0dGFjaGVkIHRvIHRoZSByb290IHJlY29yZCBhbmRcbiAgICogcmVhZCBiYWNrIHdpdGggYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gc3BlYyAtIEJhY2tlbmQgcXVlcnktZGF0YSBuYW1lcyBhbmQgYXJndW1lbnRzIHRvIHNlcmlhbGl6ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gVGhpcyBxdWVyeSBmb3IgY2hhaW5pbmcuXG4gICAqL1xuICBxdWVyeURhdGEoc3BlYykge1xuICAgIGlmIChzcGVjID09IG51bGwpIHJldHVybiB0aGlzXG5cbiAgICB0aGlzLl9xdWVyeURhdGEucHVzaCgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoc3BlYykpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gUm9vdC1tb2RlbCB3aGVyZSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCB3aGVyZSBjb25kaXRpb25zLlxuICAgKi9cbiAgd2hlcmUoY29uZGl0aW9ucykge1xuICAgIHRoaXMubW9kZWxDbGFzcy5hc3NlcnRGaW5kQnlDb25kaXRpb25zKGNvbmRpdGlvbnMpXG5cbiAgICB0aGlzLl93aGVyZSA9IHtcbiAgICAgIC4uLnRoaXMuX3doZXJlLFxuICAgICAgLi4uY29uZGl0aW9uc1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY29wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn0gc2NvcGVEZXNjcmlwdG9yIC0gU2NvcGUgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgc2NvcGUoc2NvcGVEZXNjcmlwdG9yKSB7XG4gICAgaWYgKCFpc01vZGVsU2NvcGVEZXNjcmlwdG9yKHNjb3BlRGVzY3JpcHRvcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNjb3BlKCkgZXhwZWN0cyBhIGRlc2NyaXB0b3IgcmV0dXJuZWQgYnkgZGVmaW5lU2NvcGUoLi4uKS5zY29wZSguLi4pXCIpXG4gICAgfVxuXG4gICAgaWYgKHNjb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzICE9PSB0aGlzLm1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFwcGx5ICR7c2NvcGVEZXNjcmlwdG9yLm1vZGVsQ2xhc3MubmFtZX0gc2NvcGUgdG8gJHt0aGlzLm1vZGVsQ2xhc3MubmFtZX0gcXVlcnlgKVxuICAgIH1cblxuICAgIGNvbnN0IHNjb3BlZFF1ZXJ5ID0gLyoqIEB0eXBlIHt0aGlzIHwgdm9pZH0gKi8gKHNjb3BlRGVzY3JpcHRvci5jYWxsYmFjayh7XG4gICAgICBkcml2ZXI6IG51bGwsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICBxdWVyeTogdGhpcyxcbiAgICAgIHRhYmxlOiBudWxsXG4gICAgfSwgLi4uc2NvcGVEZXNjcmlwdG9yLnNjb3BlQXJncykpXG5cbiAgICByZXR1cm4gc2NvcGVkUXVlcnkgfHwgdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guIFN1cHBvcnRzIGBzYCBrZXkgZm9yIHNvcnRpbmcgKGUuZy4sIGB7czogXCJuYW1lIGFzY1wifWApLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIFJhbnNhY2sgZmlsdGVycyBhbmQgc29ydCBhcHBsaWVkLlxuICAgKi9cbiAgcmFuc2FjayhwYXJhbXMpIHtcbiAgICBjb25zdCB7cywgLi4uZmlsdGVyUGFyYW1zfSA9IHBhcmFtc1xuICAgIGNvbnN0IGhhc0ZpbHRlcnMgPSBPYmplY3Qua2V5cyhmaWx0ZXJQYXJhbXMpLmxlbmd0aCA+IDBcblxuICAgIGlmIChoYXNGaWx0ZXJzKSB7XG4gICAgICBub3JtYWxpemVSYW5zYWNrR3JvdXAodGhpcy5tb2RlbENsYXNzLCBmaWx0ZXJQYXJhbXMpXG4gICAgICB0aGlzLl9yYW5zYWNrLnB1c2goZmlsdGVyUGFyYW1zKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcyA9PT0gXCJzdHJpbmdcIiAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzb3J0cyA9IHBhcnNlUmFuc2Fja1NvcnQodGhpcy5tb2RlbENsYXNzLCBzKVxuXG4gICAgICBmb3IgKGNvbnN0IHNvcnREZWYgb2Ygc29ydHMpIHtcbiAgICAgICAgdGhpcy5zb3J0KFtbc29ydERlZi5hdHRyaWJ1dGUsIHNvcnREZWYuZGlyZWN0aW9uXV0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdCB3aXRoIHJlcXVpcmVkIHJvb3QgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW3JlcXVpcmVkQXR0cmlidXRlc10gLSBFeHRyYSByZXF1aXJlZCBhdHRyaWJ1dGVzIGZvciB0aGUgcm9vdCBtb2RlbC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gLSBTZWxlY3QgbWFwIHdpdGggcmVxdWlyZWQgcm9vdCBhdHRyaWJ1dGVzIG1lcmdlZCB3aGVuIHJvb3Qgc2VsZWN0IGV4aXN0cy5cbiAgICovXG4gIHNlbGVjdFdpdGhSZXF1aXJlZFJvb3RBdHRyaWJ1dGVzKHJlcXVpcmVkQXR0cmlidXRlcyA9IFtdKSB7XG4gICAgY29uc3Qgcm9vdE1vZGVsTmFtZSA9IHRoaXMubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHNlbGVjdE1hcCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqLyAodGhpcy5fc2VsZWN0KVxuICAgIGNvbnN0IGV4aXN0aW5nUm9vdEF0dHJpYnV0ZXMgPSBzZWxlY3RNYXBbcm9vdE1vZGVsTmFtZV1cblxuICAgIGlmICghZXhpc3RpbmdSb290QXR0cmlidXRlcykge1xuICAgICAgcmV0dXJuIHNlbGVjdE1hcFxuICAgIH1cblxuICAgIGNvbnN0IHJvb3RQcmltYXJ5S2V5ID0gdGhpcy5tb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnNlbGVjdE1hcCxcbiAgICAgIFtyb290TW9kZWxOYW1lXTogQXJyYXkuZnJvbShuZXcgU2V0KFtyb290UHJpbWFyeUtleSwgLi4uZXhpc3RpbmdSb290QXR0cmlidXRlcywgLi4ucmVxdWlyZWRBdHRyaWJ1dGVzXSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIHRvIG1lcmdlLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCBwcmVsb2Fkcy5cbiAgICovXG4gIHByZWxvYWQocHJlbG9hZCkge1xuICAgIG1lcmdlUHJlbG9hZFJlY29yZCh0aGlzLl9wcmVsb2FkLCBub3JtYWxpemVQcmVsb2FkKHByZWxvYWQpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgbWVyZ2VTZWxlY3RSZWNvcmQodGhpcy5fc2VsZWN0LCBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIGBzZWxlY3QoLi4uKWAsIGJ1dCBrZWVwcyB0aGUgZGVmYXVsdCBzZXJpYWxpemVkIGF0dHJpYnV0ZXMgYW5kIGxvYWRzXG4gICAqIHRoZSBnaXZlbiBleHRyYXMgaW4gYWRkaXRpb24gKGZvciBleGFtcGxlIGF0dHJpYnV0ZXMgZGVjbGFyZWRcbiAgICogYHNlbGVjdGVkQnlEZWZhdWx0OiBmYWxzZWApLiBLZXllZCBieSBtb2RlbCBuYW1lLCB3aXRoIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIGV4dHJhIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgbWVyZ2VTZWxlY3RSZWNvcmQodGhpcy5fc2VsZWN0c0V4dHJhLCBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGpvaW5zIC0gUmVsYXRpb25zaGlwIGRlc2NyaXB0b3Igam9pbnMuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggbWVyZ2VkIGpvaW5zLlxuICAgKi9cbiAgam9pbnMoam9pbnMpIHtcbiAgICBtZXJnZUpvaW5SZWNvcmQodGhpcy5fam9pbnMsIG5vcm1hbGl6ZUpvaW5zKGpvaW5zKSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2VhcmNoIHJlc3VsdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwiPlwiIHwgXCI+PVwiIHwgXCI8XCIgfCBcIjw9XCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBzZWFyY2guXG4gICAqL1xuICBzZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgc2VhcmNoIHBhdGggbXVzdCBiZSBhbiBhcnJheSwgZ290OiAke3R5cGVvZiBwYXRofWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBwYXRoRW50cnkgb2YgcGF0aCkge1xuICAgICAgaWYgKHR5cGVvZiBwYXRoRW50cnkgIT09IFwic3RyaW5nXCIgfHwgcGF0aEVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2VhcmNoIHBhdGggZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb2x1bW4gIT09IFwic3RyaW5nXCIgfHwgY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNlYXJjaCBjb2x1bW4gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG9wZXJhdG9yICE9PSBcInN0cmluZ1wiIHx8IG9wZXJhdG9yLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNlYXJjaCBvcGVyYXRvciBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRvciA9IG5vcm1hbGl6ZVNlYXJjaE9wZXJhdG9yKG9wZXJhdG9yKVxuXG4gICAgdGhpcy5fc2VhcmNoZXMucHVzaCh7XG4gICAgICBjb2x1bW4sXG4gICAgICBvcGVyYXRvcjogbm9ybWFsaXplZE9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnBhdGhdLFxuICAgICAgdmFsdWVcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc29ydChzb3J0KSB7XG4gICAgdGhpcy5fc29ydC5wdXNoKC4uLm5vcm1hbGl6ZVNvcnQoc29ydCkpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gb3JkZXIgLSBPcmRlciBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGFwcGVuZGVkIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvcmRlcihvcmRlcikge1xuICAgIHJldHVybiB0aGlzLnNvcnQob3JkZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBncm91cCBkZWZpbml0aW9ucy5cbiAgICovXG4gIGdyb3VwKGdyb3VwKSB7XG4gICAgdGhpcy5fZ3JvdXAucHVzaCguLi5ub3JtYWxpemVHcm91cChncm91cCkpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFdoZXRoZXIgdG8gcmVxdWVzdCBkaXN0aW5jdCByb3dzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGRpc3RpbmN0IGZsYWcuXG4gICAqL1xuICBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBkaXN0aW5jdCBtdXN0IGJlIGEgYm9vbGVhbiwgZ290OiAke3R5cGVvZiB2YWx1ZX1gKVxuICAgIH1cblxuICAgIHRoaXMuX2Rpc3RpbmN0ID0gdmFsdWVcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbGltaXQgcmVzdWx0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgbGltaXQodmFsdWUpIHtcbiAgICB0aGlzLl9saW1pdCA9IG5vcm1hbGl6ZUludGVnZXJBcmd1bWVudCh2YWx1ZSwgXCJsaW1pdFwiLCB7bWluOiAwfSlcbiAgICB0aGlzLl9wYWdlID0gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBvZmZzZXQodmFsdWUpIHtcbiAgICB0aGlzLl9vZmZzZXQgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQodmFsdWUsIFwib2Zmc2V0XCIsIHttaW46IDB9KVxuICAgIHRoaXMuX3BhZ2UgPSBudWxsXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIHBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHRoaXMuX3BhZ2UgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQocGFnZU51bWJlciwgXCJwYWdlXCIsIHttaW46IDF9KVxuICAgIGNvbnN0IHBhZ2VTaXplID0gdGhpcy5fcGVyUGFnZSB8fCAzMFxuXG4gICAgdGhpcy5fbGltaXQgPSBwYWdlU2l6ZVxuICAgIHRoaXMuX29mZnNldCA9ICh0aGlzLl9wYWdlIC0gMSkgKiBwYWdlU2l6ZVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBwZXItcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgcGVyUGFnZShwZXJQYWdlKSB7XG4gICAgdGhpcy5fcGVyUGFnZSA9IG5vcm1hbGl6ZUludGVnZXJBcmd1bWVudChwZXJQYWdlLCBcInBlclBhZ2VcIiwge21pbjogMX0pXG5cbiAgICBpZiAodGhpcy5fcGFnZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5fbGltaXQgPSB0aGlzLl9wZXJQYWdlXG4gICAgICB0aGlzLl9vZmZzZXQgPSAodGhpcy5fcGFnZSAtIDEpICogdGhpcy5fcGVyUGFnZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9uZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBDbG9uZWQgcXVlcnkgaW5zdGFuY2UuXG4gICAqL1xuICBjbG9uZSgpIHtcbiAgICBjb25zdCBuZXdRdWVyeSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7XG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MsXG4gICAgICBwcmVsb2FkOiBub3JtYWxpemVQcmVsb2FkKHRoaXMuX3ByZWxvYWQpXG4gICAgfSkpXG5cbiAgICBuZXdRdWVyeS5fam9pbnMgPSBub3JtYWxpemVKb2lucyh0aGlzLl9qb2lucylcbiAgICBuZXdRdWVyeS5fd2hlcmUgPSB7Li4udGhpcy5fd2hlcmV9XG4gICAgbmV3UXVlcnkuX3JhbnNhY2sgPSB0aGlzLl9yYW5zYWNrLm1hcCgocmFuc2Fja1BhcmFtcykgPT4gKHsuLi5yYW5zYWNrUGFyYW1zfSkpXG4gICAgbmV3UXVlcnkuX3NlYXJjaGVzID0gdGhpcy5fc2VhcmNoZXMubWFwKChzZWFyY2gpID0+ICh7XG4gICAgICBjb2x1bW46IHNlYXJjaC5jb2x1bW4sXG4gICAgICBvcGVyYXRvcjogc2VhcmNoLm9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnNlYXJjaC5wYXRoXSxcbiAgICAgIHZhbHVlOiBzZWFyY2gudmFsdWVcbiAgICB9KSlcbiAgICBuZXdRdWVyeS5fc2VsZWN0ID0gbm9ybWFsaXplU2VsZWN0KHRoaXMuX3NlbGVjdClcbiAgICBuZXdRdWVyeS5fc2VsZWN0c0V4dHJhID0gbm9ybWFsaXplU2VsZWN0KHRoaXMuX3NlbGVjdHNFeHRyYSlcbiAgICBuZXdRdWVyeS5fc29ydCA9IHRoaXMuX3NvcnQubWFwKChzb3J0RW50cnkpID0+ICh7XG4gICAgICBjb2x1bW46IHNvcnRFbnRyeS5jb2x1bW4sXG4gICAgICBkaXJlY3Rpb246IHNvcnRFbnRyeS5kaXJlY3Rpb24sXG4gICAgICBwYXRoOiBbLi4uc29ydEVudHJ5LnBhdGhdXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX2dyb3VwID0gdGhpcy5fZ3JvdXAubWFwKChncm91cEVudHJ5KSA9PiAoe1xuICAgICAgY29sdW1uOiBncm91cEVudHJ5LmNvbHVtbixcbiAgICAgIHBhdGg6IFsuLi5ncm91cEVudHJ5LnBhdGhdXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX2Rpc3RpbmN0ID0gdGhpcy5fZGlzdGluY3RcbiAgICBuZXdRdWVyeS5fbGltaXQgPSB0aGlzLl9saW1pdFxuICAgIG5ld1F1ZXJ5Ll9vZmZzZXQgPSB0aGlzLl9vZmZzZXRcbiAgICBuZXdRdWVyeS5fcGFnZSA9IHRoaXMuX3BhZ2VcbiAgICBuZXdRdWVyeS5fcGVyUGFnZSA9IHRoaXMuX3BlclBhZ2VcbiAgICBuZXdRdWVyeS5fd2l0aENvdW50ID0gdGhpcy5fd2l0aENvdW50Lm1hcCgoZW50cnkpID0+ICh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBlbnRyeS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSA/IHsuLi5lbnRyeS53aGVyZX0gOiB1bmRlZmluZWRcbiAgICB9KSlcbiAgICBuZXdRdWVyeS5fcXVlcnlEYXRhID0gdGhpcy5fcXVlcnlEYXRhLm1hcCgoZW50cnkpID0+IChcbiAgICAgIHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiA/IGVudHJ5IDogey4uLmVudHJ5fVxuICAgICkpXG4gICAgbmV3UXVlcnkuX2FiaWxpdGllcyA9IHRoaXMuX2FiaWxpdGllcy5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgYWN0aW9uczogWy4uLmVudHJ5LmFjdGlvbnNdLFxuICAgICAgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWVcbiAgICB9KSlcblxuICAgIHJldHVybiBuZXdRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VH0gLSBSb290IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBwcmVsb2FkIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcHJlbG9hZFBheWxvYWQoKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3ByZWxvYWQpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge3ByZWxvYWQ6IHRoaXMuX3ByZWxvYWR9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvdW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCB3aXRoQ291bnQgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgd2l0aENvdW50UGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fd2l0aENvdW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgd2l0aENvdW50OiB0aGlzLl93aXRoQ291bnQubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogZW50cnkuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlIHx8IHVuZGVmaW5lZFxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBhYmlsaXRpZXMgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgYWJpbGl0aWVzUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fYWJpbGl0aWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0aWVzOiB0aGlzLl9hYmlsaXRpZXMubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgYWN0aW9uczogWy4uLmVudHJ5LmFjdGlvbnNdLFxuICAgICAgICBtb2RlbE5hbWU6IGVudHJ5Lm1vZGVsTmFtZVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgZGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgcXVlcnlEYXRhIHNwZWMgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcXVlcnlEYXRhUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fcXVlcnlEYXRhLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICAvLyBTaW5nbGUgYWNjdW11bGF0ZWQgc3BlYyBnb2VzIG9uIHRoZSB3aXJlIHZlcmJhdGltLiBUaGUgYmFja2VuZFxuICAgIC8vIG5vcm1hbGl6ZXIgYWNjZXB0cyBzdHJpbmcvYXJyYXkvb2JqZWN0IGF0IGVhY2ggbGV2ZWwsIHNvIHdlIGNhblxuICAgIC8vIHNoaXAgbXVsdGlwbGUgYC5xdWVyeURhdGEoLi4uKWAgY2FsbHMgYXMgYW4gYXJyYXkuXG4gICAgcmV0dXJuIHtcbiAgICAgIHF1ZXJ5RGF0YTogdGhpcy5fcXVlcnlEYXRhLmxlbmd0aCA9PT0gMSA/IHRoaXMuX3F1ZXJ5RGF0YVswXSA6IHRoaXMuX3F1ZXJ5RGF0YVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbcmVxdWlyZWRBdHRyaWJ1dGVzXSAtIEV4dHJhIHJlcXVpcmVkIGF0dHJpYnV0ZXMgZm9yIHJvb3QgbW9kZWwgc2VsZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VsZWN0IGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VsZWN0UGF5bG9hZChyZXF1aXJlZEF0dHJpYnV0ZXMgPSBbXSkge1xuICAgIGNvbnN0IHNlbGVjdCA9IHRoaXMuc2VsZWN0V2l0aFJlcXVpcmVkUm9vdEF0dHJpYnV0ZXMocmVxdWlyZWRBdHRyaWJ1dGVzKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHNlbGVjdCkubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7c2VsZWN0fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0cyBleHRyYSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VsZWN0c0V4dHJhIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VsZWN0c0V4dHJhUGF5bG9hZCgpIHtcbiAgICBpZiAoT2JqZWN0LmtleXModGhpcy5fc2VsZWN0c0V4dHJhKS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtzZWxlY3RzRXh0cmE6IHRoaXMuX3NlbGVjdHNFeHRyYX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlYXJjaCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc2VhcmNoZXMgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc2VhcmNoUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fc2VhcmNoZXMubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBzZWFyY2hlczogdGhpcy5fc2VhcmNoZXMubWFwKChzZWFyY2gpID0+ICh7XG4gICAgICAgIGNvbHVtbjogc2VhcmNoLmNvbHVtbixcbiAgICAgICAgb3BlcmF0b3I6IHNlYXJjaC5vcGVyYXRvcixcbiAgICAgICAgcGF0aDogWy4uLnNlYXJjaC5wYXRoXSxcbiAgICAgICAgdmFsdWU6IHNlYXJjaC52YWx1ZVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2FjayBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgcmFuc2FjayBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHJhbnNhY2tQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLl9yYW5zYWNrLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICBpZiAodGhpcy5fcmFuc2Fjay5sZW5ndGggPT09IDEpIHtcbiAgICAgIHJldHVybiB7cmFuc2FjazogdGhpcy5fcmFuc2Fja1swXX1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcmFuc2Fjazoge1xuICAgICAgICBnOiB0aGlzLl9yYW5zYWNrLFxuICAgICAgICBtOiBcImFuZFwiXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIGpvaW5zIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgam9pbnNQYXlsb2FkKCkge1xuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9qb2lucykubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBqb2luczogbm9ybWFsaXplSm9pbnModGhpcy5fam9pbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc29ydCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgc29ydCBhcnJheSB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBzb3J0UGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fc29ydC5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNvcnQ6IHRoaXMuX3NvcnQubWFwKChzb3J0RW50cnkpID0+ICh7XG4gICAgICAgIGNvbHVtbjogc29ydEVudHJ5LmNvbHVtbixcbiAgICAgICAgZGlyZWN0aW9uOiBzb3J0RW50cnkuZGlyZWN0aW9uLFxuICAgICAgICBwYXRoOiBbLi4uc29ydEVudHJ5LnBhdGhdXG4gICAgICB9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgZ3JvdXAgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgZ3JvdXBQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLl9ncm91cC5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGdyb3VwOiB0aGlzLl9ncm91cC5tYXAoKGdyb3VwRW50cnkpID0+ICh7XG4gICAgICAgIGNvbHVtbjogZ3JvdXBFbnRyeS5jb2x1bW4sXG4gICAgICAgIHBhdGg6IFsuLi5ncm91cEVudHJ5LnBhdGhdXG4gICAgICB9KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXN0aW5jdCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgZGlzdGluY3QgZmxhZyB3aGVuIGVuYWJsZWQuXG4gICAqL1xuICBkaXN0aW5jdFBheWxvYWQoKSB7XG4gICAgaWYgKCF0aGlzLl9kaXN0aW5jdCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGlzdGluY3Q6IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgd2hlcmUgaGFzaCB3aGVuIHByZXNlbnQuXG4gICAqL1xuICB3aGVyZVBheWxvYWQoKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3doZXJlKS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHdoZXJlOiB0aGlzLl93aGVyZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2luYXRpb24gcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHBhZ2luYXRpb24gcGFyYW1zIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHBhZ2luYXRpb25QYXlsb2FkKCkge1xuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGlmICh0aGlzLl9saW1pdCAhPT0gbnVsbCkgcGF5bG9hZC5saW1pdCA9IHRoaXMuX2xpbWl0XG4gICAgaWYgKHRoaXMuX29mZnNldCAhPT0gbnVsbCkgcGF5bG9hZC5vZmZzZXQgPSB0aGlzLl9vZmZzZXRcbiAgICBpZiAodGhpcy5fcGFnZSAhPT0gbnVsbCkgcGF5bG9hZC5wYWdlID0gdGhpcy5fcGFnZVxuICAgIGlmICh0aGlzLl9wZXJQYWdlICE9PSBudWxsKSBwYXlsb2FkLnBlclBhZ2UgPSB0aGlzLl9wZXJQYWdlXG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGV2ZW50IHF1ZXJ5IHN1cHBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqIEB0aHJvd3Mge0Vycm9yfSBXaGVuIHRoZSBxdWVyeSBjb250YWlucyBsaXN0LW9ubHkgb3B0aW9ucyB0aGF0IGNhbm5vdCBmaWx0ZXIgYSBzaW5nbGUgbGlmZWN5Y2xlIGV2ZW50LlxuICAgKi9cbiAgYXNzZXJ0RXZlbnRRdWVyeVN1cHBvcnRlZCgpIHtcbiAgICAvKipcbiAgICAgKiBVbnN1cHBvcnRlZCBvcHRpb25zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB1bnN1cHBvcnRlZE9wdGlvbnMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX3NvcnQubGVuZ3RoID4gMCkgdW5zdXBwb3J0ZWRPcHRpb25zLnB1c2goXCJzb3J0XCIpXG4gICAgaWYgKHRoaXMuX2dyb3VwLmxlbmd0aCA+IDApIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwiZ3JvdXBcIilcbiAgICBpZiAodGhpcy5fZGlzdGluY3QpIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwiZGlzdGluY3RcIilcbiAgICBpZiAodGhpcy5fcmFuc2Fjay5sZW5ndGggPiAwKSB1bnN1cHBvcnRlZE9wdGlvbnMucHVzaChcInJhbnNhY2tcIilcbiAgICBpZiAodGhpcy5fbGltaXQgIT09IG51bGwgfHwgdGhpcy5fb2Zmc2V0ICE9PSBudWxsIHx8IHRoaXMuX3BhZ2UgIT09IG51bGwgfHwgdGhpcy5fcGVyUGFnZSAhPT0gbnVsbCkgdW5zdXBwb3J0ZWRPcHRpb25zLnB1c2goXCJwYWdpbmF0aW9uXCIpXG5cbiAgICBpZiAodW5zdXBwb3J0ZWRPcHRpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJpZXMgZG8gbm90IHN1cHBvcnQgJHt1bnN1cHBvcnRlZE9wdGlvbnMuam9pbihcIiwgXCIpfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gUHJvamVjdGlvbiBwYXlsb2FkIHVzZWQgd2hlbiBzZXJpYWxpemluZyBsaWZlY3ljbGUgZXZlbnRzLlxuICAgKi9cbiAgZXZlbnRQcm9qZWN0aW9uUGF5bG9hZCgpIHtcbiAgICB0aGlzLmFzc2VydEV2ZW50UXVlcnlTdXBwb3J0ZWQoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnRoaXMucHJlbG9hZFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWxlY3RzRXh0cmFQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndpdGhDb3VudFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuYWJpbGl0aWVzUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5xdWVyeURhdGFQYXlsb2FkKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsfSAtIFF1ZXJ5IHBpZWNlcyB1c2VkIHRvIG1hdGNoIGxpZmVjeWNsZSBldmVudHMuXG4gICAqL1xuICBldmVudEZpbHRlclBheWxvYWQoKSB7XG4gICAgdGhpcy5hc3NlcnRFdmVudFF1ZXJ5U3VwcG9ydGVkKClcblxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndoZXJlUGF5bG9hZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHBheWxvYWQpLmxlbmd0aCA9PT0gMCA/IG51bGwgOiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXZlbnRPcHRpb25zUGF5bG9hZCByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWR9IC0gQ29tYmluZWQgZXZlbnQgZmlsdGVyIGFuZCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gICAqL1xuICBldmVudE9wdGlvbnNQYXlsb2FkKCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyUGF5bG9hZCA9IHRoaXMuZXZlbnRGaWx0ZXJQYXlsb2FkKClcblxuICAgIHJldHVybiB7XG4gICAgICBldmVudEZpbHRlcktleTogZXZlbnRGaWx0ZXJQYXlsb2FkID8gZnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyS2V5KGV2ZW50RmlsdGVyUGF5bG9hZCkgOiBudWxsLFxuICAgICAgZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgcHJvamVjdGlvblBheWxvYWQ6IHRoaXMuZXZlbnRQcm9qZWN0aW9uUGF5bG9hZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiaW5kZXhcIiwge1xuICAgICAgLi4udGhpcy5wcmVsb2FkUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucmFuc2Fja1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWxlY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlbGVjdHNFeHRyYVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZ3JvdXBQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmRpc3RpbmN0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zb3J0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy53aGVyZVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2l0aENvdW50UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5hYmlsaXRpZXNQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnF1ZXJ5RGF0YVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucGFnaW5hdGlvblBheWxvYWQoKVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsc0RhdGEgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLm1vZGVscykgPyByZXNwb25zZS5tb2RlbHMgOiBbXVxuICAgIC8qKlxuICAgICAqIE1vZGVscy5cbiAgICAgKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+W119ICovXG4gICAgY29uc3QgbW9kZWxzID0gbW9kZWxzRGF0YS5tYXAoKG1vZGVsKSA9PiB0aGlzLm1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UobW9kZWwpKVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyBzbyBhdXRvLWJhdGNoLXByZWxvYWRcbiAgICAvLyBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLiBTaW5nbGUtcmVjb3JkIGxvb2t1cHMgc3RpbGwgZmxvd1xuICAgIC8vIHRocm91Z2ggaGVyZSAod2l0aCBhIGNvaG9ydCBvZiBvbmUpIGFuZCBkZWdyYWRlIGNsZWFubHkgdG8gcGVyLXJlY29yZCBsb2FkLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobW9kZWwpLl9sb2FkQ29ob3J0ID0gbW9kZWxzXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJpbmRleFwiLCB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5yYW5zYWNrUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2hlcmVQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnBhZ2luYXRpb25QYXlsb2FkKCksXG4gICAgICBjb3VudDogdHJ1ZVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHJlc3BvbnNlLmNvdW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBudW1lcmljIGNvdW50IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2UuY291bnR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBtYXRjaGluZyBxdWVyeS5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5jbG9uZSgpXG5cbiAgICBpZiAocXVlcnkuX3NvcnQubGVuZ3RoIDwgMSkge1xuICAgICAgcXVlcnkuc29ydChbW3RoaXMubW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIFwiYXNjXCJdXSlcbiAgICB9XG5cbiAgICBxdWVyeS5saW1pdCgxKVxuXG4gICAgY29uc3QgbW9kZWxzID0gYXdhaXQgcXVlcnkudG9BcnJheSgpXG5cbiAgICByZXR1cm4gbW9kZWxzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgbWF0Y2hpbmcgcXVlcnkuXG4gICAqL1xuICBhc3luYyBsYXN0KCkge1xuICAgIC8vIFdoZW4gcGFnaW5hdGlvbiBpcyBhbHJlYWR5IGFwcGxpZWQsIGZldGNoIHRoYXQgc2NvcGVkIHdpbmRvdyBhbmQgcmV0dXJuIGl0cyBsYXN0IGl0ZW0uXG4gICAgaWYgKHRoaXMuX29mZnNldCAhPT0gbnVsbCB8fCB0aGlzLl9wYWdlICE9PSBudWxsIHx8IHRoaXMuX3BlclBhZ2UgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMudG9BcnJheSgpXG5cbiAgICAgIGlmIChtb2RlbHMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIG1vZGVsc1ttb2RlbHMubGVuZ3RoIC0gMV1cbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuY2xvbmUoKVxuXG4gICAgaWYgKHF1ZXJ5Ll9zb3J0Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHF1ZXJ5LnNvcnQoW1t0aGlzLm1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBcImRlc2NcIl1dKVxuICAgIH0gZWxzZSB7XG4gICAgICBxdWVyeS5fc29ydCA9IHF1ZXJ5Ll9zb3J0Lm1hcCgoc29ydEVudHJ5KSA9PiAoe1xuICAgICAgICAuLi5zb3J0RW50cnksXG4gICAgICAgIGRpcmVjdGlvbjogcmV2ZXJzZVNvcnREaXJlY3Rpb24oc29ydEVudHJ5LmRpcmVjdGlvbilcbiAgICAgIH0pKVxuICAgIH1cblxuICAgIHF1ZXJ5LmxpbWl0KDEpXG5cbiAgICBjb25zdCBtb2RlbHMgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcblxuICAgIHJldHVybiBtb2RlbHNbMF0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgYXN5bmMgcGx1Y2soLi4uY29sdW1ucykge1xuICAgIGlmIChjb2x1bW5zLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbHVtbnMgZ2l2ZW4gdG8gcGx1Y2tcIilcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkUGx1Y2sgPSBub3JtYWxpemVQbHVjayhjb2x1bW5zLmxlbmd0aCA9PT0gMSA/IGNvbHVtbnNbMF0gOiBjb2x1bW5zKVxuICAgIGNvbnN0IGFsbG93ZWRQbHVjayA9IGFzc2VydFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHtcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgIHBsdWNrOiBub3JtYWxpemVkUGx1Y2tcbiAgICB9KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiaW5kZXhcIiwge1xuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5ncm91cFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZGlzdGluY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNvcnRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndoZXJlUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5wYWdpbmF0aW9uUGF5bG9hZCgpLFxuICAgICAgcGx1Y2s6IGFsbG93ZWRQbHVja1xuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS52YWx1ZXMpKSB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2UudmFsdWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRm91bmQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kKGlkKSB7XG4gICAgY29uc3QgcGsgPSB0aGlzLm1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZpbmRCeSh7W3BrXTogaWR9KVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gbm90IGZvdW5kIHdpdGggJHtwa309JHtpZH1gKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGb3VuZCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29uZGl0aW9ucyA9IHRoaXMudmFsaWRhdGVkU3RydWN0dXJlZENvbmRpdGlvbnMoY29uZGl0aW9ucylcbiAgICBjb25zdCBtZXJnZWRXaGVyZSA9IHtcbiAgICAgIC4uLnRoaXMuX3doZXJlLFxuICAgICAgLi4ubm9ybWFsaXplZENvbmRpdGlvbnNcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImluZGV4XCIsIHtcbiAgICAgIC4uLnRoaXMucHJlbG9hZFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuam9pbnNQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlYXJjaFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0UGF5bG9hZChPYmplY3Qua2V5cyhtZXJnZWRXaGVyZSkpLFxuICAgICAgLi4udGhpcy5zZWxlY3RzRXh0cmFQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc29ydFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuYWJpbGl0aWVzUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5wYWdpbmF0aW9uUGF5bG9hZCgpLFxuICAgICAgd2hlcmU6IG1lcmdlZFdoZXJlXG4gICAgfSlcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCByZXNwb25zZSBidXQgZ290OiAke3Jlc3BvbnNlfWApXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5tb2RlbHMpID8gcmVzcG9uc2UubW9kZWxzIDogW11cblxuICAgIGZvciAoY29uc3QgbW9kZWxEYXRhIG9mIG1vZGVscykge1xuICAgICAgY29uc3QgbW9kZWwgPSB0aGlzLm1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UobW9kZWxEYXRhKVxuXG4gICAgICBpZiAodGhpcy5tb2RlbENsYXNzLm1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBtZXJnZWRXaGVyZSkpIHtcbiAgICAgICAgcmV0dXJuIG1vZGVsXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEZvdW5kIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZmluZEJ5KGNvbmRpdGlvbnMpXG5cbiAgICBpZiAoIW1vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZCBmb3IgY29uZGl0aW9uczogJHtzZXJpYWxpemVGaW5kQ29uZGl0aW9ucyhjb25kaXRpb25zKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgaW5pdGlhbGl6ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucykge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRDb25kaXRpb25zID0gdGhpcy52YWxpZGF0ZWRTdHJ1Y3R1cmVkQ29uZGl0aW9ucyhjb25kaXRpb25zKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmIChtb2RlbCkgcmV0dXJuIG1vZGVsXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KSA9PiBJbnN0YW5jZVR5cGU8VD59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MpKVxuXG4gICAgcmV0dXJuIG5ldyBNb2RlbENsYXNzKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKG5vcm1hbGl6ZWRDb25kaXRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KG1vZGVsOiBJbnN0YW5jZVR5cGU8VD4pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBbY2FsbGJhY2tdIC0gT3B0aW9uYWwgY2FsbGJhY2sgYmVmb3JlIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbmRpdGlvbnMgPSB0aGlzLnZhbGlkYXRlZFN0cnVjdHVyZWRDb25kaXRpb25zKGNvbmRpdGlvbnMpXG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgaWYgKG1vZGVsKSByZXR1cm4gbW9kZWxcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMubW9kZWxDbGFzcykpXG4gICAgY29uc3QgbmV3TW9kZWwgPSBuZXcgTW9kZWxDbGFzcygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChub3JtYWxpemVkQ29uZGl0aW9ucykpXG5cbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKG5ld01vZGVsKVxuICAgIH1cblxuICAgIGF3YWl0IG5ld01vZGVsLnNhdmUoKVxuXG4gICAgcmV0dXJuIG5ld01vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZGF0ZWQgc3RydWN0dXJlZCBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENhbmRpZGF0ZSBzdHJ1Y3R1cmVkIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVmFsaWRhdGVkIGNvbmRpdGlvbnMuXG4gICAqL1xuICB2YWxpZGF0ZWRTdHJ1Y3R1cmVkQ29uZGl0aW9ucyhjb25kaXRpb25zKSB7XG4gICAgdGhpcy5tb2RlbENsYXNzLmFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucylcblxuICAgIHJldHVybiBjb25kaXRpb25zXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IGZpbHRlciBrZXkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWR9IHBheWxvYWQgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgZXZlbnQgZmlsdGVyIG1hdGNoaW5nLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJLZXkocGF5bG9hZCkge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGF5bG9hZClcbn1cblxuLyoqXG4gKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBxdWVyeSAtIFF1ZXJ5IHJlY2VpdmluZyBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9uc30gb3B0aW9ucyAtIFByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUZyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9ucyhxdWVyeSwgb3B0aW9ucykge1xuICBpZiAob3B0aW9ucy5zZWxlY3QgIT09IHVuZGVmaW5lZCkgcXVlcnkuc2VsZWN0KG9wdGlvbnMuc2VsZWN0KVxuICBpZiAob3B0aW9ucy5zZWxlY3RzRXh0cmEgIT09IHVuZGVmaW5lZCkgcXVlcnkuc2VsZWN0c0V4dHJhKG9wdGlvbnMuc2VsZWN0c0V4dHJhKVxuICBpZiAob3B0aW9ucy5wcmVsb2FkICE9PSB1bmRlZmluZWQpIHF1ZXJ5LnByZWxvYWQob3B0aW9ucy5wcmVsb2FkKVxuICBpZiAob3B0aW9ucy53aXRoQ291bnQgIT09IHVuZGVmaW5lZCkgcXVlcnkud2l0aENvdW50KG9wdGlvbnMud2l0aENvdW50KVxuICBpZiAob3B0aW9ucy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkgcXVlcnkuYWJpbGl0aWVzKG9wdGlvbnMuYWJpbGl0aWVzKVxuICBpZiAob3B0aW9ucy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCkgcXVlcnkucXVlcnlEYXRhKG9wdGlvbnMucXVlcnlEYXRhKVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJ5IGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gcXVlcnkgLSBFdmVudCBxdWVyeS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeUNsYXNzKG1vZGVsQ2xhc3MsIHF1ZXJ5KSB7XG4gIGlmIChxdWVyeS5tb2RlbENsYXNzID09PSBtb2RlbENsYXNzKSByZXR1cm5cblxuICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzdWJzY3JpYmUgJHttb2RlbENsYXNzLm5hbWV9IGV2ZW50cyB3aXRoIGEgJHtxdWVyeS5tb2RlbENsYXNzLm5hbWV9IHF1ZXJ5YClcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIENhbmRpZGF0ZSBldmVudCBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3Qob3B0aW9ucykge1xuICBpZiAob3B0aW9ucyAmJiB0eXBlb2Ygb3B0aW9ucyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSkgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb25zIG11c3QgYmUgYSBxdWVyeSBvciBhbiBvcHRpb25zIG9iamVjdCwgZ290OiAke29wdGlvbnN9YClcbn1cblxuLyoqXG4gKiBSdW5zIGNsb25lZCBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUXVlcnk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IHF1ZXJ5IC0gRXZlbnQgcXVlcnkuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAtIENsb25lZCBxdWVyeSB1c2VkIGJ5IGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGNsb25lZEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5KG1vZGVsQ2xhc3MsIHF1ZXJ5KSB7XG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5Q2xhc3MobW9kZWxDbGFzcywgcXVlcnkpXG5cbiAgcmV0dXJuIHF1ZXJ5LmNsb25lKClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJ5IGZyb20gb3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMgb2JqZWN0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gLSBRdWVyeSB1c2VkIGJ5IGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5RnJvbU9wdGlvbnNPYmplY3QobW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBpZiAob3B0aW9ucy5xdWVyeSAhPT0gdW5kZWZpbmVkICYmICEob3B0aW9ucy5xdWVyeSBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxRdWVyeSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb24gcXVlcnkgbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxRdWVyeVwiKVxuICB9XG5cbiAgY29uc3QgcXVlcnkgPSBvcHRpb25zLnF1ZXJ5XG4gICAgPyBvcHRpb25zLnF1ZXJ5LmNsb25lKClcbiAgICA6IG5ldyBGcm9udGVuZE1vZGVsUXVlcnkoe21vZGVsQ2xhc3N9KVxuXG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5Q2xhc3MobW9kZWxDbGFzcywgcXVlcnkpXG5cbiAgcmV0dXJuIHF1ZXJ5XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAtIE5vcm1hbGl6ZWQgcXVlcnkgdXNlZCBieSBldmVudCBzdWJzY3JpcHRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKG9wdGlvbnMgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsUXVlcnkpIHJldHVybiBjbG9uZWRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3Qob3B0aW9ucylcblxuICBjb25zdCBvcHRpb25zT2JqZWN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSAqLyAob3B0aW9ucylcbiAgY29uc3QgcXVlcnkgPSBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeUZyb21PcHRpb25zT2JqZWN0KG1vZGVsQ2xhc3MsIG9wdGlvbnNPYmplY3QpXG5cbiAgYXBwbHlGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnMocXVlcnksIG9wdGlvbnNPYmplY3QpXG5cbiAgcmV0dXJuIHF1ZXJ5XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZH0gLSBOb3JtYWxpemVkIGV2ZW50IHN1YnNjcmlwdGlvbiBwYXlsb2FkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQobW9kZWxDbGFzcywgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gb3B0aW9ucyBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxRdWVyeSA/IHVuZGVmaW5lZCA6IG9wdGlvbnMucmVxdWVzdENvbnRleHRcblxuICByZXR1cm4ge1xuICAgIC4uLmZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5KG1vZGVsQ2xhc3MsIG9wdGlvbnMpLmV2ZW50T3B0aW9uc1BheWxvYWQoKSxcbiAgICByZXF1ZXN0Q29udGV4dFxuICB9XG59XG4iXX0=