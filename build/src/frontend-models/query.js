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
 * Defines this typedef.
 * @typedef {FrontendModelProjectionOptions & {query?: FrontendModelQuery<import("./base.js").FrontendModelClass>}} FrontendModelEventOptionsObject
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
 * FrontendModelEventOptionsPayload type.
 * @typedef {object} FrontendModelEventOptionsPayload
 * @property {string | null} eventFilterKey - Stable event filter key, or null when no filter is present.
 * @property {FrontendModelEventFilterPayload | null} eventFilterPayload - Normalized event filter payload, or null when unfiltered.
 * @property {FrontendModelProjectionPayload} projectionPayload - Normalized event serialization projection payload.
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
     * @returns {FrontendModelEventOptionsPayload} - Combined event filter and projection payload.
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
    return frontendModelEventQuery(modelClass, options).eventOptionsPayload();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzRSxPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUVwRDs7Ozs7OztHQU9HO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNILHdFQUF3RTtBQUN4RSxNQUFNLE9BQU8sdUJBQXdCLFNBQVEsS0FBSztJQUNoRDs7O09BR0c7SUFDSCxZQUFZLE9BQU87UUFDakIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRWQsSUFBSSxDQUFDLElBQUksR0FBRyx5QkFBeUIsQ0FBQTtJQUN2QyxDQUFDO0NBQ0Y7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxPQUFPO0lBQ3RDLE9BQU8sSUFBSSx1QkFBdUIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtBQUM3QyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxnQkFBZ0IsQ0FBQyxPQUFPO0lBQ3RDLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxFQUFFLENBQUE7SUFFdkIsSUFBSSxPQUFPLEtBQUssSUFBSTtRQUFFLE9BQU8sRUFBRSxD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LENBQUMsVUFBVSxFQUFFLE9BQU8sR0FBRyxFQUFFO0lBQ3ZELElBQUksT0FBTyxZQUFZLGtCQUFrQjtRQUFFLE9BQU8sNkJBQTZCLENBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFBO0lBRXBHLHFDQUFxQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBRTlDLE1BQU0sYUFBYSxHQUFHLDhDQUE4QyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDOUUsTUFBTSxLQUFLLEdBQUcsd0NBQXdDLENBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyxDQUFBO0lBRWpGLG1DQUFtQyxDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQTtJQUV6RCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxnQ0FBZ0MsQ0FBQyxVQUFVLEVBQUUsT0FBTyxHQUFHLEVBQUU7SUFDdkUsT0FBTyx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtBQUMzRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7cmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzc30gZnJvbSBcIi4vbW9kZWwtcmVnaXN0cnkuanNcIlxuaW1wb3J0IHtub3JtYWxpemVSYW5zYWNrR3JvdXAsIHBhcnNlUmFuc2Fja1NvcnR9IGZyb20gXCIuLi91dGlscy9yYW5zYWNrLmpzXCJcbmltcG9ydCB7aXNNb2RlbFNjb3BlRGVzY3JpcHRvcn0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxTZWFyY2ggdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzZWFyY2guXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHR5cGUuXG4gKiBAdHlwZWRlZiB7bnVsbCB8IGJvb2xlYW4gfCBudW1iZXIgfCBzdHJpbmcgfCBvYmplY3R9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZSB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fX0gRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3ttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119fSBGcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFByb2plY3Rpb25PcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IFtzZWxlY3RdIC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBbc2VsZWN0c0V4dHJhXSAtIEV4dHJhIGF0dHJpYnV0ZXMgdG8gbG9hZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gW3ByZWxvYWRdIC0gUmVsYXRpb25zaGlwIHByZWxvYWQgdHJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fT59IFt3aXRoQ291bnRdIC0gQXNzb2NpYXRpb24gY291bnQgc3BlYy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IFthYmlsaXRpZXNdIC0gQWJpbGl0eSBhY3Rpb25zIHRvIGNvbXB1dGUgcGVyIHJlY29yZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPj4gfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbcXVlcnlEYXRhXSAtIEJhY2tlbmQgcXVlcnkgZGF0YSBuYW1lcy9zcGVjLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9ucyAmIHtxdWVyeT86IEZyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn19IEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3RcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdCB8IEZyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1xuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gW3NlbGVjdF0gLSBOb3JtYWxpemVkIHNlbGVjdCBtYXAuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gW3NlbGVjdHNFeHRyYV0gLSBOb3JtYWxpemVkIGV4dHJhIHNlbGVjdCBtYXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IFtwcmVsb2FkXSAtIE5vcm1hbGl6ZWQgcHJlbG9hZCB0cmVlLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5W119IFt3aXRoQ291bnRdIC0gTm9ybWFsaXplZCBjb3VudCBzcGVjcy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeVtdfSBbYWJpbGl0aWVzXSAtIE5vcm1hbGl6ZWQgYWJpbGl0eSBzcGVjcy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBbcXVlcnlEYXRhXSAtIE5vcm1hbGl6ZWQgcXVlcnlEYXRhIHNwZWMuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZFxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbam9pbnNdIC0gUmVsYXRpb25zaGlwIGpvaW5zIG5lZWRlZCBmb3IgbWF0Y2hpbmcuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gW3NlYXJjaGVzXSAtIFNlYXJjaCBwcmVkaWNhdGVzIG5lZWRlZCBmb3IgbWF0Y2hpbmcuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IFt3aGVyZV0gLSBTdHJ1Y3R1cmVkIHdoZXJlIHByZWRpY2F0ZXMgbmVlZGVkIGZvciBtYXRjaGluZy5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkICYge2tleTogc3RyaW5nfX0gRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGV2ZW50RmlsdGVyS2V5IC0gU3RhYmxlIGV2ZW50IGZpbHRlciBrZXksIG9yIG51bGwgd2hlbiBubyBmaWx0ZXIgaXMgcHJlc2VudC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB8IG51bGx9IGV2ZW50RmlsdGVyUGF5bG9hZCAtIE5vcm1hbGl6ZWQgZXZlbnQgZmlsdGVyIHBheWxvYWQsIG9yIG51bGwgd2hlbiB1bmZpbHRlcmVkLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHByb2plY3Rpb25QYXlsb2FkIC0gTm9ybWFsaXplZCBldmVudCBzZXJpYWxpemF0aW9uIHByb2plY3Rpb24gcGF5bG9hZC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsU29ydCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsR3JvdXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxHcm91cFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIGdyb3VwIGJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGx1Y2sgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQbHVja1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHBsdWNrLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqIEVycm9yIHJhaXNlZCB3aGVuIGEgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZGVzY3JpcHRvciBpcyBtYWxmb3JtZWQuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuXG4gICAgdGhpcy5uYW1lID0gXCJGcm9udGVuZE1vZGVsUXVlcnlFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBxdWVyeSBkZXNjcmlwdG9yIGVycm9yLlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yfSAtIFF1ZXJ5IGRlc2NyaXB0b3IgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpIHtcbiAgcmV0dXJuIG5ldyBGcm9udGVuZE1vZGVsUXVlcnlFcnJvcihtZXNzYWdlKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZVByZWxvYWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD4gfCBib29sZWFuIHwgdW5kZWZpbmVkIHwgbnVsbH0gcHJlbG9hZCAtIFByZWxvYWQgc2hvcnRoYW5kLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IC0gTm9ybWFsaXplZCBwcmVsb2FkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUHJlbG9hZChwcmVsb2FkKSB7XG4gIGlmICghcHJlbG9hZCkgcmV0dXJuIHt9XG5cbiAgaWYgKHByZWxvYWQgPT09IHRydWUpIHJldHVybiB7fVxuXG4gIGlmICh0eXBlb2YgcHJlbG9hZCA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB7W3ByZWxvYWRdOiB0cnVlfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocHJlbG9hZCkpIHtcbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcmVsb2FkKSB7XG4gICAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIG5vcm1hbGl6ZWRbZW50cnldID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdChlbnRyeSkpIHtcbiAgICAgICAgbWVyZ2VQcmVsb2FkUmVjb3JkKG5vcm1hbGl6ZWQsIG5vcm1hbGl6ZVByZWxvYWQoZW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwcmVsb2FkIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChwcmVsb2FkKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHByZWxvYWQgdHlwZTogJHt0eXBlb2YgcHJlbG9hZH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBQcmVsb2FkXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkKSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBQcmVsb2FkID09PSB0cnVlIHx8IHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IGZhbHNlKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gcmVsYXRpb25zaGlwUHJlbG9hZFxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IFwic3RyaW5nXCIgfHwgQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQcmVsb2FkKSB8fCBpc1BsYWluT2JqZWN0KHJlbGF0aW9uc2hpcFByZWxvYWQpKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gbm9ybWFsaXplUHJlbG9hZChyZWxhdGlvbnNoaXBQcmVsb2FkKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwcmVsb2FkIHZhbHVlIGZvciAke3JlbGF0aW9uc2hpcE5hbWV9OiAke3R5cGVvZiByZWxhdGlvbnNoaXBQcmVsb2FkfWApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSB0aGUgc2hvcnRoYW5kIGB3aXRoQ291bnRgIGFyZ3VtZW50IGZyb20gdGhlIGZyb250ZW5kLW1vZGVsXG4gKiBxdWVyeSBBUEkgaW50byB0aGUgc3RyaWN0IGludGVybmFsIGVudHJpZXMgdXNlZCBpbiB0aGUgdHJhbnNwb3J0XG4gKiBwYXlsb2FkLiBTaGFyZXMgdGhlIHNoYXBlIHNlbWFudGljcyB3aXRoIHRoZSBiYWNrZW5kIG5vcm1hbGl6ZXIgaW5cbiAqIGBkYXRhYmFzZS9xdWVyeS93aXRoLWNvdW50LmpzYC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gc3BlYyAtIEFzc29jaWF0aW9uLWNvdW50IHNob3J0aGFuZCB0byBub3JtYWxpemUuXG4gKiBAcmV0dXJucyB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIE5vcm1hbGl6ZWQgYXNzb2NpYXRpb24tY291bnQgcmVxdWVzdHMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdpdGhDb3VudEZyb250ZW5kKHNwZWMpIHtcbiAgaWYgKHNwZWMgPT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzcGVjID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFt7YXR0cmlidXRlTmFtZTogYCR7c3BlY31Db3VudGAsIHJlbGF0aW9uc2hpcE5hbWU6IHNwZWN9XVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc3BlYykpIHtcbiAgICByZXR1cm4gc3BlYy5mbGF0TWFwKChpdGVtKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGl0ZW0gIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoQ291bnQgYXJyYXkgZW50cmllcyBtdXN0IGJlIHN0cmluZ3M7IGdvdCAke3R5cGVvZiBpdGVtfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbe2F0dHJpYnV0ZU5hbWU6IGAke2l0ZW19Q291bnRgLCByZWxhdGlvbnNoaXBOYW1lOiBpdGVtfV1cbiAgICB9KVxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHNwZWMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHdpdGhDb3VudCBzcGVjOiAke3R5cGVvZiBzcGVjfWApXG4gIH1cblxuICBjb25zdCBlbnRyaWVzID0gW11cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzcGVjKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgZW50cmllcy5wdXNoKHthdHRyaWJ1dGVOYW1lOiBgJHtrZXl9Q291bnRgLCByZWxhdGlvbnNoaXBOYW1lOiBrZXl9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSBjb250aW51ZVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICBjb25zdCBvcHRpb25zID0gLyoqIEB0eXBlIHt7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovICh2YWx1ZSlcbiAgICAgIGVudHJpZXMucHVzaCh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IGtleSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogb3B0aW9ucy5yZWxhdGlvbnNoaXAgfHwga2V5LFxuICAgICAgICB3aGVyZTogb3B0aW9ucy53aGVyZVxuICAgICAgfSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHdpdGhDb3VudCB2YWx1ZSBmb3IgJHtrZXl9OiAke3R5cGVvZiB2YWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIGVudHJpZXNcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSBmcm9udGVuZCBgLmFiaWxpdGllcyguLi4pYCBzcGVjIGludG8gYSBmbGF0IGxpc3Qgb2ZcbiAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcy4gQWNjZXB0cyB0aGUgZmxhdCBhY3Rpb25zLWFycmF5XG4gKiBzaG9ydGhhbmQgKGFwcGxpZXMgdG8gdGhlIHF1ZXJ5J3Mgb3duIG1vZGVsIGNsYXNzKSBhbmQgdGhlIGtleWVkXG4gKiBge01vZGVsTmFtZTogW2FjdGlvbiwgLi4uXX1gIGZvcm0gKGFwcGxpZXMgdG8gcmVjb3JkcyBvZiB0aGF0IG1vZGVsXG4gKiBjbGFzcywgdXNlZnVsIGZvciBwcmVsb2FkZWQgY2hpbGRyZW4pLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc3BlYyAtIEFiaWxpdHkgYWN0aW9ucyBncm91cGVkIGJ5IG1vZGVsLCBvciByb290LW1vZGVsIGFjdGlvbiBzaG9ydGhhbmQuXG4gKiBAcGFyYW0ge3tnZXRNb2RlbE5hbWU6ICgpID0+IHN0cmluZ319IHJvb3RNb2RlbENsYXNzIC0gUXVlcnkgcm9vdCB1c2VkIGJ5IHRoZSBmbGF0IGFjdGlvbiBzaG9ydGhhbmQuXG4gKiBAcmV0dXJucyB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQWJpbGl0aWVzU3BlYyhzcGVjLCByb290TW9kZWxDbGFzcykge1xuICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAoQXJyYXkuaXNBcnJheShzcGVjKSkge1xuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIHNwZWMpIHtcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgYWJpbGl0aWVzIGZsYXQtZm9ybSBhY3Rpb25zIG11c3QgYmUgbm9uLWVtcHR5IHN0cmluZ3M7IGdvdCAke3R5cGVvZiBhY3Rpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByb290TW9kZWxOYW1lID0gcm9vdE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImFiaWxpdGllcyBmbGF0LWZvcm0gcmVxdWlyZXMgYSByb290IG1vZGVsIGNsYXNzIHdpdGggZ2V0TW9kZWxOYW1lKClcIilcbiAgICB9XG5cbiAgICByZXR1cm4gW3thY3Rpb25zOiBbLi4uc3BlY10sIG1vZGVsTmFtZTogcm9vdE1vZGVsTmFtZX1dXG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3Qoc3BlYykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYWJpbGl0aWVzIHNwZWM6ICR7dHlwZW9mIHNwZWN9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnRyaWVzLlxuICAgKiBAdHlwZSB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAqL1xuICBjb25zdCBlbnRyaWVzID0gW11cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGFjdGlvbnNdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMpKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGFiaWxpdGllc1ske21vZGVsTmFtZX1dIG11c3QgYmUgYW4gYXJyYXkgb2YgYWN0aW9uIG5hbWVzOyBnb3QgJHt0eXBlb2YgYWN0aW9uc31gKVxuICAgIH1cblxuICAgIGNvbnN0IHNhbml0aXplZCA9IGFjdGlvbnMubWFwKChhY3Rpb24pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgYWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgYWJpbGl0aWVzWyR7bW9kZWxOYW1lfV0gZW50cmllcyBtdXN0IGJlIG5vbi1lbXB0eSBzdHJpbmdzOyBnb3QgJHt0eXBlb2YgYWN0aW9ufWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpb25cbiAgICB9KVxuXG4gICAgZW50cmllcy5wdXNoKHthY3Rpb25zOiBzYW5pdGl6ZWQsIG1vZGVsTmFtZX0pXG4gIH1cblxuICByZXR1cm4gZW50cmllc1xufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgcHJlbG9hZCByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IHRhcmdldFByZWxvYWQgLSBFeGlzdGluZyBwcmVsb2FkIGRhdGEuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9IGluY29taW5nUHJlbG9hZCAtIE5ldyBwcmVsb2FkIGRhdGEuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VQcmVsb2FkUmVjb3JkKHRhcmdldFByZWxvYWQsIGluY29taW5nUHJlbG9hZCkge1xuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCBpbmNvbWluZ1ZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhpbmNvbWluZ1ByZWxvYWQpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFByZWxvYWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmIChpbmNvbWluZ1ZhbHVlID09PSBmYWxzZSkge1xuICAgICAgdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IGZhbHNlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChpbmNvbWluZ1ZhbHVlID09PSB0cnVlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRhcmdldFByZWxvYWRbcmVsYXRpb25zaGlwTmFtZV0gPSB0cnVlXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghaXNQbGFpbk9iamVjdChpbmNvbWluZ1ZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByZWxvYWQgdmFsdWUgZm9yICR7cmVsYXRpb25zaGlwTmFtZX06ICR7dHlwZW9mIGluY29taW5nVmFsdWV9YClcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChleGlzdGluZ1ZhbHVlKSkge1xuICAgICAgbWVyZ2VQcmVsb2FkUmVjb3JkKFxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovIChleGlzdGluZ1ZhbHVlKSxcbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqLyAoaW5jb21pbmdWYWx1ZSlcbiAgICAgIClcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgdGFyZ2V0UHJlbG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZVByZWxvYWQoaW5jb21pbmdWYWx1ZSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHNlbGVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNlbGVjdCAtIFNlbGVjdCBwYXlsb2FkLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbcm9vdE1vZGVsTmFtZV0gLSBPcHRpb25hbCByb290IG1vZGVsIG5hbWUgZm9yIHNob3J0aGFuZCBzZWxlY3QgcGF5bG9hZHMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAtIE5vcm1hbGl6ZWQgbW9kZWwtbmFtZSBrZXllZCBzZWxlY3QgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTZWxlY3Qoc2VsZWN0LCByb290TW9kZWxOYW1lID0gbnVsbCkge1xuICBpZiAoIXNlbGVjdCkgcmV0dXJuIHt9XG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwic3RyaW5nXCIpIHtcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgc2VsZWN0IHNob3J0aGFuZCB3aXRob3V0IHJvb3QgbW9kZWwgbmFtZVwiKVxuXG4gICAgcmV0dXJuIHtbcm9vdE1vZGVsTmFtZV06IFtzZWxlY3RdfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0KSkge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzZWxlY3Qgc2hvcnRoYW5kIHdpdGhvdXQgcm9vdCBtb2RlbCBuYW1lXCIpXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0KSB7XG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlbGVjdCBhdHRyaWJ1dGUgZm9yICR7cm9vdE1vZGVsTmFtZX06ICR7dHlwZW9mIGF0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdCkpfVxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHNlbGVjdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IHR5cGU6ICR7dHlwZW9mIHNlbGVjdH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgc2VsZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhzZWxlY3QpKSB7XG4gICAgaWYgKHR5cGVvZiBzZWxlY3Rpb24gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWRbbW9kZWxOYW1lXSA9IFtzZWxlY3Rpb25dXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWxlY3Rpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IHZhbHVlIGZvciAke21vZGVsTmFtZX06ICR7dHlwZW9mIHNlbGVjdGlvbn1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3Rpb24pIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0IGF0dHJpYnV0ZSBmb3IgJHttb2RlbE5hbWV9OiAke3R5cGVvZiBhdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdGlvbikpXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2Ugc2VsZWN0IHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXRTZWxlY3QgLSBFeGlzdGluZyBzZWxlY3QgcmVjb3JkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IGluY29taW5nU2VsZWN0IC0gSW5jb21pbmcgc2VsZWN0IHJlY29yZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVNlbGVjdFJlY29yZCh0YXJnZXRTZWxlY3QsIGluY29taW5nU2VsZWN0KSB7XG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgaW5jb21pbmdBdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhpbmNvbWluZ1NlbGVjdCkpIHtcbiAgICBjb25zdCBleGlzdGluZ0F0dHJpYnV0ZXMgPSB0YXJnZXRTZWxlY3RbbW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgdGFyZ2V0U2VsZWN0W21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoWy4uLmV4aXN0aW5nQXR0cmlidXRlcywgLi4uaW5jb21pbmdBdHRyaWJ1dGVzXSkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBub3JtYWxpemVTZWFyY2hPcGVyYXRvciBoZWxwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0b3IgLSBSYXcgc2VhcmNoIG9wZXJhdG9yLlxuICogQHJldHVybnMge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gLSBOb3JtYWxpemVkIG9wZXJhdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU2VhcmNoT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuICBjb25zdCBub3JtYWxpemVkT3BlcmF0b3IgPSBvcGVyYXRvckFsaWFzZXNbLyoqIEB0eXBlIHtcIjxcIiB8IFwiPD1cIiB8IFwiPlwiIHwgXCI+PVwifSAqLyAob3BlcmF0b3IpXSB8fCBvcGVyYXRvclxuICBjb25zdCBzdXBwb3J0ZWRPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibGlrZVwiLCBcIm5vdEVxXCIsIFwiZ3RcIiwgXCJndGVxXCIsIFwibHRcIiwgXCJsdGVxXCJdKVxuXG4gIGlmICghc3VwcG9ydGVkT3BlcmF0b3JzLmhhcyhub3JtYWxpemVkT3BlcmF0b3IpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYHNlYXJjaCBvcGVyYXRvciBtdXN0IGJlIG9uZSBvZjogZXEsIGxpa2UsIG5vdEVxLCBndCwgZ3RlcSwgbHQsIGx0ZXEsID4sID49LCA8LCA8PSAoZ290OiAke29wZXJhdG9yfSlgKVxuICB9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwifSAqLyAobm9ybWFsaXplZE9wZXJhdG9yKVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2Ugam9pbiByZWNvcmQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdGFyZ2V0Sm9pbnMgLSBFeGlzdGluZyBqb2luIHJlY29yZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBpbmNvbWluZ0pvaW5zIC0gSW5jb21pbmcgam9pbiByZWNvcmQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VKb2luUmVjb3JkKHRhcmdldEpvaW5zLCBpbmNvbWluZ0pvaW5zKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIGluY29taW5nVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGluY29taW5nSm9pbnMpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldEpvaW5zW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAoaW5jb21pbmdWYWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0YXJnZXRKb2luc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHRydWVcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGluY29taW5nVmFsdWUpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2luIHZhbHVlIGZvciAke3JlbGF0aW9uc2hpcE5hbWV9OiAke3R5cGVvZiBpbmNvbWluZ1ZhbHVlfWApXG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QoZXhpc3RpbmdWYWx1ZSkpIHtcbiAgICAgIG1lcmdlSm9pblJlY29yZChleGlzdGluZ1ZhbHVlLCBpbmNvbWluZ1ZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdHJ1ZSkge1xuICAgICAgdGFyZ2V0Sm9pbnNbcmVsYXRpb25zaGlwTmFtZV0gPSBub3JtYWxpemVKb2lucyhpbmNvbWluZ1ZhbHVlKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0YXJnZXRKb2luc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZUpvaW5zKGluY29taW5nVmFsdWUpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBub3JtYWxpemVKb2lucyBoZWxwZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBqb2lucyAtIEpvaW4gcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTm9ybWFsaXplZCByZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUpvaW5zKGpvaW5zKSB7XG4gIGlmICgham9pbnMpIHJldHVybiB7fVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGpvaW5zKSkge1xuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICAgIGZvciAoY29uc3Qgam9pbkVudHJ5IG9mIGpvaW5zKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3Qoam9pbkVudHJ5KSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2lucyBlbnRyeSB0eXBlOiAke3R5cGVvZiBqb2luRW50cnl9YClcbiAgICAgIH1cblxuICAgICAgbWVyZ2VKb2luUmVjb3JkKG5vcm1hbGl6ZWQsIG5vcm1hbGl6ZUpvaW5zKGpvaW5FbnRyeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChqb2lucykpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBqb2lucyB0eXBlOiAke3R5cGVvZiBqb2luc31gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcEpvaW5dIG9mIE9iamVjdC5lbnRyaWVzKGpvaW5zKSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBKb2luID09PSB0cnVlKSB7XG4gICAgICBub3JtYWxpemVkW3JlbGF0aW9uc2hpcE5hbWVdID0gdHJ1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdChyZWxhdGlvbnNoaXBKb2luKSkge1xuICAgICAgbm9ybWFsaXplZFtyZWxhdGlvbnNoaXBOYW1lXSA9IG5vcm1hbGl6ZUpvaW5zKHJlbGF0aW9uc2hpcEpvaW4pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGpvaW4gZGVmaW5pdGlvbiBmb3IgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCI6ICR7dHlwZW9mIHJlbGF0aW9uc2hpcEpvaW59YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc29ydCBkaXJlY3Rpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBkaXJlY3Rpb24gLSBEaXJlY3Rpb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7XCJhc2NcIiB8IFwiZGVzY1wifSAtIE5vcm1hbGl6ZWQgZGlyZWN0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTb3J0RGlyZWN0aW9uKGRpcmVjdGlvbikge1xuICBpZiAodHlwZW9mIGRpcmVjdGlvbiAhPT0gXCJzdHJpbmdcIikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGlyZWN0aW9uIHR5cGU6ICR7dHlwZW9mIGRpcmVjdGlvbn1gKVxuICB9XG5cbiAgY29uc3Qgbm9ybWFsaXplZERpcmVjdGlvbiA9IGRpcmVjdGlvbi50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gIGlmIChub3JtYWxpemVkRGlyZWN0aW9uICE9PSBcImFzY1wiICYmIG5vcm1hbGl6ZWREaXJlY3Rpb24gIT09IFwiZGVzY1wiKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkaXJlY3Rpb246ICR7ZGlyZWN0aW9ufWApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZERpcmVjdGlvblxufVxuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgYSB2YWx1ZSBpcyBhIHR3by1pdGVtIGBbY29sdW1uLCBkaXJlY3Rpb25dYCBzb3J0IHR1cGxlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgW3N0cmluZywgc3RyaW5nXX0gLSBXaGV0aGVyIHZhbHVlIGlzIGEgc29ydCB0dXBsZS5cbiAqL1xuZnVuY3Rpb24gc29ydFR1cGxlKHZhbHVlKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuICBpZiAodmFsdWUubGVuZ3RoICE9PSAyKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZVswXSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlXG4gIGlmICh0eXBlb2YgdmFsdWVbMV0gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAodmFsdWVbMF0udHJpbSgpLmxlbmd0aCA8IDEpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGRpcmVjdGlvbiA9IHZhbHVlWzFdLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgcmV0dXJuIGRpcmVjdGlvbiA9PT0gXCJhc2NcIiB8fCBkaXJlY3Rpb24gPT09IFwiZGVzY1wiXG59XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIHZhbHVlIGlzIGEgc3RydWN0dXJlZCBzb3J0IGRlc2NyaXB0b3Igd2l0aCBhIHJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgZGVzY3JpcHRvci5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7Y29sdW1uOiBzdHJpbmcsIGRpcmVjdGlvbjogc3RyaW5nLCBwYXRoOiBzdHJpbmdbXX19IC0gV2hldGhlciB2YWx1ZSBpcyBhbiBleHBsaWNpdCBzb3J0IGRlc2NyaXB0b3Igb2JqZWN0LlxuICovXG5mdW5jdGlvbiBzb3J0RGVzY3JpcHRvcih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKCEoXCJjb2x1bW5cIiBpbiB2YWx1ZSkgfHwgIShcImRpcmVjdGlvblwiIGluIHZhbHVlKSB8fCAhKFwicGF0aFwiIGluIHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmICh0eXBlb2YgdmFsdWUuY29sdW1uICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZS5kaXJlY3Rpb24gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUucGF0aCkpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiB2YWx1ZS5wYXRoLmV2ZXJ5KChwYXRoRW50cnkpID0+IHR5cGVvZiBwYXRoRW50cnkgPT09IFwic3RyaW5nXCIpXG59XG5cbi8qKlxuICogUGFyc2UgYSBzdHJpbmcgc2hvcnRoYW5kIGludG8gYSBzb3J0IGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydFZhbHVlIC0gU29ydCBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbcGF0aF0gLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU29ydH0gLSBOb3JtYWxpemVkIHNvcnQgZGVzY3JpcHRvci5cbiAqL1xuZnVuY3Rpb24gcGFyc2VTb3J0U3RyaW5nKHNvcnRWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzb3J0VmFsdWUudHJpbSgpXG5cbiAgaWYgKHRyaW1tZWQubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwic29ydCB2YWx1ZSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICB9XG5cbiAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi1cIikpIHtcbiAgICBjb25zdCBjb2x1bW4gPSB0cmltbWVkLnNsaWNlKDEpLnRyaW0oKVxuXG4gICAgaWYgKGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb246ICR7c29ydFZhbHVlfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbHVtbixcbiAgICAgIGRpcmVjdGlvbjogXCJkZXNjXCIsXG4gICAgICBwYXRoOiBbLi4ucGF0aF1cbiAgICB9XG4gIH1cblxuICBjb25zdCBzb3J0UGFydHMgPSB0cmltbWVkLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pXG5cbiAgaWYgKHNvcnRQYXJ0cy5sZW5ndGggPiAyKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkZWZpbml0aW9uOiAke3NvcnRWYWx1ZX1gKVxuICB9XG5cbiAgY29uc3QgY29sdW1uID0gc29ydFBhcnRzWzBdXG5cbiAgaWYgKGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBkZWZpbml0aW9uOiAke3NvcnRWYWx1ZX1gKVxuICB9XG5cbiAgY29uc3QgZGlyZWN0aW9uID0gc29ydFBhcnRzLmxlbmd0aCA9PT0gMlxuICAgID8gbm9ybWFsaXplU29ydERpcmVjdGlvbihzb3J0UGFydHNbMV0pXG4gICAgOiBcImFzY1wiXG5cbiAgcmV0dXJuIHtcbiAgICBjb2x1bW4sXG4gICAgZGlyZWN0aW9uLFxuICAgIHBhdGg6IFsuLi5wYXRoXVxuICB9XG59XG5cbi8qKlxuICogUGFyc2UgYSB0dXBsZSBzaG9ydGhhbmQgaW50byBhIHNvcnQgZGVzY3JpcHRvci5cbiAqIEBwYXJhbSB7W3N0cmluZywgc3RyaW5nXX0gc29ydFZhbHVlIC0gU29ydCB0dXBsZS5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0fSAtIE5vcm1hbGl6ZWQgc29ydCBkZXNjcmlwdG9yLlxuICovXG5mdW5jdGlvbiBwYXJzZVNvcnRUdXBsZShzb3J0VmFsdWUsIHBhdGggPSBbXSkge1xuICBjb25zdCBbY29sdW1uVmFsdWUsIGRpcmVjdGlvblZhbHVlXSA9IHNvcnRWYWx1ZVxuICBjb25zdCBjb2x1bW4gPSBjb2x1bW5WYWx1ZS50cmltKClcblxuICBpZiAoY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcInNvcnQgdHVwbGUgY29sdW1uIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvbHVtbixcbiAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oZGlyZWN0aW9uVmFsdWUpLFxuICAgIHBhdGg6IFsuLi5wYXRoXVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgbmVzdGVkIG9iamVjdCBzb3J0IHBheWxvYWQgaW50byBmbGF0IHNvcnQgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gc29ydFZhbHVlIC0gTmVzdGVkIHNvcnQgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0W119IC0gTm9ybWFsaXplZCBzb3J0IGRlc2NyaXB0b3JzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTb3J0T2JqZWN0KHNvcnRWYWx1ZSwgcGF0aCkge1xuICAvKipcbiAgICogTm9ybWFsaXplZCBzb3J0cy5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTb3J0W119ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWRTb3J0cyA9IFtdXG5cbiAgZm9yIChjb25zdCBbc29ydEtleSwgc29ydEVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhzb3J0VmFsdWUpKSB7XG4gICAgaWYgKHR5cGVvZiBzb3J0RW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKHtcbiAgICAgICAgY29sdW1uOiBzb3J0S2V5LFxuICAgICAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oc29ydEVudHJ5KSxcbiAgICAgICAgcGF0aDogWy4uLnBhdGhdXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoc29ydFR1cGxlKHNvcnRFbnRyeSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKHBhcnNlU29ydFR1cGxlKHNvcnRFbnRyeSwgWy4uLnBhdGgsIHNvcnRLZXldKSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoc29ydEVudHJ5KSkge1xuICAgICAgaWYgKHNvcnRFbnRyeS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNvcnQgZGVmaW5pdGlvbiBmb3IgXCIke3NvcnRLZXl9XCI6IGVtcHR5IGFycmF5YClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBuZXN0ZWRTb3J0RW50cnkgb2Ygc29ydEVudHJ5KSB7XG4gICAgICAgIGlmICghc29ydFR1cGxlKG5lc3RlZFNvcnRFbnRyeSkpIHtcbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb24gZm9yIFwiJHtzb3J0S2V5fVwiOiBleHBlY3RlZCBbY29sdW1uLCBkaXJlY3Rpb25dIHR1cGxlc2ApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkU29ydHMucHVzaChwYXJzZVNvcnRUdXBsZShuZXN0ZWRTb3J0RW50cnksIFsuLi5wYXRoLCBzb3J0S2V5XSkpXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChpc1BsYWluT2JqZWN0KHNvcnRFbnRyeSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRTb3J0cy5wdXNoKC4uLm5vcm1hbGl6ZVNvcnRPYmplY3Qoc29ydEVudHJ5LCBbLi4ucGF0aCwgc29ydEtleV0pKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzb3J0IGRlZmluaXRpb24gZm9yIFwiJHtzb3J0S2V5fVwiOiAke3R5cGVvZiBzb3J0RW50cnl9YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkU29ydHNcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYW55IHN1cHBvcnRlZCBzb3J0IHBheWxvYWQgaW50byBmbGF0IHNvcnQgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzb3J0IC0gU29ydCBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTb3J0W119IC0gTm9ybWFsaXplZCBzb3J0IGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplU29ydChzb3J0KSB7XG4gIGlmICghc29ydCkgcmV0dXJuIFtdXG5cbiAgaWYgKHR5cGVvZiBzb3J0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFtwYXJzZVNvcnRTdHJpbmcoc29ydCldXG4gIH1cblxuICBpZiAoc29ydFR1cGxlKHNvcnQpKSB7XG4gICAgcmV0dXJuIFtwYXJzZVNvcnRUdXBsZShzb3J0KV1cbiAgfVxuXG4gIGlmIChzb3J0RGVzY3JpcHRvcihzb3J0KSkge1xuICAgIHJldHVybiBbe1xuICAgICAgY29sdW1uOiBzb3J0LmNvbHVtbi50cmltKCksXG4gICAgICBkaXJlY3Rpb246IG5vcm1hbGl6ZVNvcnREaXJlY3Rpb24oc29ydC5kaXJlY3Rpb24pLFxuICAgICAgcGF0aDogWy4uLnNvcnQucGF0aF1cbiAgICB9XVxuICB9XG5cbiAgaWYgKGlzUGxhaW5PYmplY3Qoc29ydCkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplU29ydE9iamVjdChzb3J0LCBbXSlcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHNvcnQpKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICAgIGZvciAoY29uc3Qgc29ydEVudHJ5IG9mIHNvcnQpIHtcbiAgICAgIGlmICh0eXBlb2Ygc29ydEVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVNvcnRTdHJpbmcoc29ydEVudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHNvcnRUdXBsZShzb3J0RW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVNvcnRUdXBsZShzb3J0RW50cnkpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoc29ydERlc2NyaXB0b3Ioc29ydEVudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goe1xuICAgICAgICAgIGNvbHVtbjogc29ydEVudHJ5LmNvbHVtbi50cmltKCksXG4gICAgICAgICAgZGlyZWN0aW9uOiBub3JtYWxpemVTb3J0RGlyZWN0aW9uKHNvcnRFbnRyeS5kaXJlY3Rpb24pLFxuICAgICAgICAgIHBhdGg6IFsuLi5zb3J0RW50cnkucGF0aF1cbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3Qoc29ydEVudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goLi4ubm9ybWFsaXplU29ydE9iamVjdChzb3J0RW50cnksIFtdKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCBlbnRyeSB0eXBlOiAke3R5cGVvZiBzb3J0RW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc29ydCB0eXBlOiAke3R5cGVvZiBzb3J0fWApXG59XG5cbi8qKlxuICogUGFyc2UgYSBzdHJpbmcgc2hvcnRoYW5kIGludG8gYSBncm91cCBkZXNjcmlwdG9yLlxuICogQHBhcmFtIHtzdHJpbmd9IGdyb3VwVmFsdWUgLSBHcm91cCBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBbcGF0aF0gLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsR3JvdXB9IC0gTm9ybWFsaXplZCBncm91cCBkZXNjcmlwdG9yLlxuICovXG5mdW5jdGlvbiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwVmFsdWUsIHBhdGggPSBbXSkge1xuICBjb25zdCB0cmltbWVkID0gZ3JvdXBWYWx1ZS50cmltKClcblxuICBpZiAoIS9eW2EtekEtWl9dW2EtekEtWjAtOV9dKiQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBncm91cCBjb2x1bW46ICR7Z3JvdXBWYWx1ZX1gKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjb2x1bW46IHRyaW1tZWQsXG4gICAgcGF0aDogWy4uLnBhdGhdXG4gIH1cbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgdmFsdWUgaXMgYSBzdHJ1Y3R1cmVkIGNvbHVtbi9wYXRoIGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBkZXNjcmlwdG9yLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHtjb2x1bW46IHN0cmluZywgcGF0aDogc3RyaW5nW119fSAtIFdoZXRoZXIgY2FuZGlkYXRlIGlzIGFuIGV4cGxpY2l0IGNvbHVtbiBkZXNjcmlwdG9yIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gY29sdW1uUGF0aERlc2NyaXB0b3IodmFsdWUpIHtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmICghKFwiY29sdW1uXCIgaW4gdmFsdWUpIHx8ICEoXCJwYXRoXCIgaW4gdmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb2x1bW4gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZVxuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUucGF0aCkpIHJldHVybiBmYWxzZVxuXG4gIHJldHVybiB2YWx1ZS5wYXRoLmV2ZXJ5KChwYXRoRW50cnkpID0+IHR5cGVvZiBwYXRoRW50cnkgPT09IFwic3RyaW5nXCIpXG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgbmVzdGVkIG9iamVjdCBjb2x1bW4gcHJvamVjdGlvbiBwYXlsb2FkIGludG8gZmxhdCBkZXNjcmlwdG9ycy5cbiAqIEB0ZW1wbGF0ZSB7e2NvbHVtbjogc3RyaW5nLCBwYXRoOiBzdHJpbmdbXX19IFRcbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIE5lc3RlZCBwcm9qZWN0aW9uIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEBwYXJhbSB7KGNvbHVtblZhbHVlOiBzdHJpbmcsIHBhdGg/OiBzdHJpbmdbXSkgPT4gVH0gcGFyc2VTdHJpbmcgLSBTdHJpbmcgcHJvamVjdGlvbiBwYXJzZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBQcm9qZWN0aW9uIGxhYmVsIGZvciBlcnJvcnMuXG4gKiBAcmV0dXJucyB7VFtdfSAtIE5vcm1hbGl6ZWQgcHJvamVjdGlvbiBkZXNjcmlwdG9ycy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdCh2YWx1ZSwgcGF0aCwgcGFyc2VTdHJpbmcsIGxhYmVsKSB7XG4gIC8qKlxuICAgKiBOb3JtYWxpemVkLlxuICAgKiBAdHlwZSB7VFtdfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICBmb3IgKGNvbnN0IFtwcm9qZWN0aW9uS2V5LCBwcm9qZWN0aW9uRW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlKSkge1xuICAgIGlmICh0eXBlb2YgcHJvamVjdGlvbkVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBub3JtYWxpemVkLnB1c2gocGFyc2VTdHJpbmcocHJvamVjdGlvbkVudHJ5LCBbLi4ucGF0aCwgcHJvamVjdGlvbktleV0pKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcm9qZWN0aW9uRW50cnkpKSB7XG4gICAgICBpZiAocHJvamVjdGlvbkVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtsYWJlbH0gZGVmaW5pdGlvbiBmb3IgXCIke3Byb2plY3Rpb25LZXl9XCI6IGVtcHR5IGFycmF5YClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBuZXN0ZWRQcm9qZWN0aW9uRW50cnkgb2YgcHJvamVjdGlvbkVudHJ5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgbmVzdGVkUHJvamVjdGlvbkVudHJ5ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtsYWJlbH0gZGVmaW5pdGlvbiBmb3IgXCIke3Byb2plY3Rpb25LZXl9XCI6IGV4cGVjdGVkIHN0cmluZyBjb2x1bW5zYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaChwYXJzZVN0cmluZyhuZXN0ZWRQcm9qZWN0aW9uRW50cnksIFsuLi5wYXRoLCBwcm9qZWN0aW9uS2V5XSkpXG4gICAgICB9XG5cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QocHJvamVjdGlvbkVudHJ5KSkge1xuICAgICAgbm9ybWFsaXplZC5wdXNoKC4uLm5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QocHJvamVjdGlvbkVudHJ5LCBbLi4ucGF0aCwgcHJvamVjdGlvbktleV0sIHBhcnNlU3RyaW5nLCBsYWJlbCkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkICR7bGFiZWx9IGRlZmluaXRpb24gZm9yIFwiJHtwcm9qZWN0aW9uS2V5fVwiOiAke3R5cGVvZiBwcm9qZWN0aW9uRW50cnl9YClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogTm9ybWFsaXplIGFueSBzdXBwb3J0ZWQgZ3JvdXAgcGF5bG9hZCBpbnRvIGZsYXQgZ3JvdXAgZGVzY3JpcHRvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBncm91cCAtIEdyb3VwIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEdyb3VwW119IC0gTm9ybWFsaXplZCBncm91cCBkZWZpbml0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwKGdyb3VwKSB7XG4gIGlmICghZ3JvdXApIHJldHVybiBbXVxuXG4gIGlmICh0eXBlb2YgZ3JvdXAgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gW3BhcnNlR3JvdXBTdHJpbmcoZ3JvdXApXVxuICB9XG5cbiAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKGdyb3VwKSkge1xuICAgIHJldHVybiBbe1xuICAgICAgY29sdW1uOiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwLmNvbHVtbikuY29sdW1uLFxuICAgICAgcGF0aDogWy4uLmdyb3VwLnBhdGhdXG4gICAgfV1cbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KGdyb3VwKSkge1xuICAgIHJldHVybiBub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KGdyb3VwLCBbXSwgcGFyc2VHcm91cFN0cmluZywgXCJncm91cFwiKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoZ3JvdXApKSB7XG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEdyb3VwW119ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwRW50cnkgb2YgZ3JvdXApIHtcbiAgICAgIGlmICh0eXBlb2YgZ3JvdXBFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBub3JtYWxpemVkLnB1c2gocGFyc2VHcm91cFN0cmluZyhncm91cEVudHJ5KSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbHVtblBhdGhEZXNjcmlwdG9yKGdyb3VwRW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICAgICAgY29sdW1uOiBwYXJzZUdyb3VwU3RyaW5nKGdyb3VwRW50cnkuY29sdW1uKS5jb2x1bW4sXG4gICAgICAgICAgcGF0aDogWy4uLmdyb3VwRW50cnkucGF0aF1cbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QoZ3JvdXBFbnRyeSkpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKC4uLm5vcm1hbGl6ZUNvbHVtblByb2plY3Rpb25PYmplY3QoZ3JvdXBFbnRyeSwgW10sIHBhcnNlR3JvdXBTdHJpbmcsIFwiZ3JvdXBcIikpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGdyb3VwIGVudHJ5IHR5cGU6ICR7dHlwZW9mIGdyb3VwRW50cnl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgZ3JvdXAgdHlwZTogJHt0eXBlb2YgZ3JvdXB9YClcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHN0cmluZyBzaG9ydGhhbmQgaW50byBhIHBsdWNrIGRlc2NyaXB0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGx1Y2tWYWx1ZSAtIFBsdWNrIHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IFtwYXRoXSAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja30gLSBOb3JtYWxpemVkIHBsdWNrIGRlc2NyaXB0b3IuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUGx1Y2tTdHJpbmcocGx1Y2tWYWx1ZSwgcGF0aCA9IFtdKSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBwbHVja1ZhbHVlLnRyaW0oKVxuXG4gIGlmICghL15bYS16QS1aX11bYS16QS1aMC05X10qJC8udGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHBsdWNrIGNvbHVtbjogJHtwbHVja1ZhbHVlfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvbHVtbjogdHJpbW1lZCxcbiAgICBwYXRoOiBbLi4ucGF0aF1cbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhbnkgc3VwcG9ydGVkIHBsdWNrIHBheWxvYWQgaW50byBmbGF0IHBsdWNrIGRlc2NyaXB0b3JzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGx1Y2sgLSBQbHVjayBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIE5vcm1hbGl6ZWQgcGx1Y2sgZGVmaW5pdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQbHVjayhwbHVjaykge1xuICBpZiAoIXBsdWNrKSByZXR1cm4gW11cblxuICBpZiAodHlwZW9mIHBsdWNrID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIFtwYXJzZVBsdWNrU3RyaW5nKHBsdWNrKV1cbiAgfVxuXG4gIGlmIChjb2x1bW5QYXRoRGVzY3JpcHRvcihwbHVjaykpIHtcbiAgICByZXR1cm4gW3tcbiAgICAgIGNvbHVtbjogcGFyc2VQbHVja1N0cmluZyhwbHVjay5jb2x1bW4pLmNvbHVtbixcbiAgICAgIHBhdGg6IFsuLi5wbHVjay5wYXRoXVxuICAgIH1dXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdChwbHVjaykpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQ29sdW1uUHJvamVjdGlvbk9iamVjdChwbHVjaywgW10sIHBhcnNlUGx1Y2tTdHJpbmcsIFwicGx1Y2tcIilcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHBsdWNrKSkge1xuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZWQuXG4gICAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBwbHVja0VudHJ5IG9mIHBsdWNrKSB7XG4gICAgICBpZiAodHlwZW9mIHBsdWNrRW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKHBhcnNlUGx1Y2tTdHJpbmcocGx1Y2tFbnRyeSkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjb2x1bW5QYXRoRGVzY3JpcHRvcihwbHVja0VudHJ5KSkge1xuICAgICAgICBub3JtYWxpemVkLnB1c2goe1xuICAgICAgICAgIGNvbHVtbjogcGFyc2VQbHVja1N0cmluZyhwbHVja0VudHJ5LmNvbHVtbikuY29sdW1uLFxuICAgICAgICAgIHBhdGg6IFsuLi5wbHVja0VudHJ5LnBhdGhdXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KHBsdWNrRW50cnkpKSB7XG4gICAgICAgIG5vcm1hbGl6ZWQucHVzaCguLi5ub3JtYWxpemVDb2x1bW5Qcm9qZWN0aW9uT2JqZWN0KHBsdWNrRW50cnksIFtdLCBwYXJzZVBsdWNrU3RyaW5nLCBcInBsdWNrXCIpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBwbHVjayBlbnRyeSB0eXBlOiAke3R5cGVvZiBwbHVja0VudHJ5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHBsdWNrIHR5cGU6ICR7dHlwZW9mIHBsdWNrfWApXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gUmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVzKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgcmVzb3VyY2VDb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKSlcbiAgY29uc3QgYXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLmF0dHJpYnV0ZXNcblxuICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgIHJldHVybiBuZXcgU2V0KGF0dHJpYnV0ZXMpXG4gIH1cblxuICBpZiAoaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzKSkge1xuICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZXQoKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGx1Y2sgdGFyZ2V0IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSAtIFRhcmdldCBtb2RlbCBjbGFzcyBmb3IgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFBsdWNrVGFyZ2V0TW9kZWxDbGFzcyhtb2RlbENsYXNzLCBwYXRoKSB7XG4gIGxldCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMgPSB0YXJnZXRNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcbiAgICBjb25zdCByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMgPSB0YXJnZXRNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IHJlbGF0aW9uc2hpcERlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyA9IHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcGx1Y2sgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzXG4gIH1cblxuICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzc1xufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IHBsdWNrIGRlZmluaXRpb25zIGFsbG93ZWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBsdWNrIGFzc2VydGlvbiBhcmdzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUGx1Y2tbXX0gYXJncy5wbHVjayAtIFBsdWNrIGRlc2NyaXB0b3JzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIEFsbG93ZWQgcGx1Y2sgZGVzY3JpcHRvcnMuXG4gKi9cbmZ1bmN0aW9uIGFzc2VydFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHttb2RlbENsYXNzLCBwbHVja30pIHtcbiAgcmV0dXJuIHBsdWNrLm1hcCgocGx1Y2tFbnRyeSkgPT4ge1xuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsUGx1Y2tUYXJnZXRNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIHBsdWNrRW50cnkucGF0aClcbiAgICBjb25zdCB0YXJnZXRBdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCF0YXJnZXRBdHRyaWJ1dGVzLmhhcyhwbHVja0VudHJ5LmNvbHVtbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwbHVjayBjb2x1bW4gXCIke3BsdWNrRW50cnkuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjb2x1bW46IHBsdWNrRW50cnkuY29sdW1uLFxuICAgICAgcGF0aDogWy4uLnBsdWNrRW50cnkucGF0aF1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzZXJpYWxpemUgZmluZCBjb25kaXRpb25zLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2VyaWFsaXplZCBjb25kaXRpb25zIGZvciBlcnJvciBtZXNzYWdlcy5cbiAqL1xuZnVuY3Rpb24gc2VyaWFsaXplRmluZENvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShjb25kaXRpb25zKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gXCJbdW5zZXJpYWxpemFibGUgY29uZGl0aW9uc11cIlxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgaW50ZWdlciBhcmd1bWVudC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGludGVnZXIgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJndW1lbnROYW1lIC0gQXJndW1lbnQgbmFtZSBmb3IgZXJyb3JzLlxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBJbnRlZ2VyIG9wdGlvbnMuXG4gKiBAcGFyYW0ge251bWJlcn0gb3B0aW9ucy5taW4gLSBNaW5pbXVtIGFsbG93ZWQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5vcm1hbGl6ZWQgaW50ZWdlciB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplSW50ZWdlckFyZ3VtZW50KHZhbHVlLCBhcmd1bWVudE5hbWUsIHttaW59KSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2FyZ3VtZW50TmFtZX0gbXVzdCBiZSBhbiBpbnRlZ2VyIG51bWJlcmApXG4gIH1cblxuICBpZiAodmFsdWUgPCBtaW4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7YXJndW1lbnROYW1lfSBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byAke21pbn1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUnVucyByZXZlcnNlIHNvcnQgZGlyZWN0aW9uLlxuICogQHBhcmFtIHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIEN1cnJlbnQgc29ydCBkaXJlY3Rpb24uXG4gKiBAcmV0dXJucyB7XCJhc2NcIiB8IFwiZGVzY1wifSAtIFJldmVyc2VkIGRpcmVjdGlvbi5cbiAqL1xuZnVuY3Rpb24gcmV2ZXJzZVNvcnREaXJlY3Rpb24oZGlyZWN0aW9uKSB7XG4gIHJldHVybiBkaXJlY3Rpb24gPT09IFwiYXNjXCIgPyBcImRlc2NcIiA6IFwiYXNjXCJcbn1cblxuLyoqXG4gKiBRdWVyeSB3cmFwcGVyIGZvciBmcm9udGVuZCBtb2RlbCBjb21tYW5kcy5cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gVFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsUXVlcnkge1xuICAvKipcbiAgICogUmFuc2Fjay5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdfSAqL1xuICBfcmFuc2FjayA9IFtdXG4gIC8qKlxuICAgKiBTZWFyY2hlcy5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi9cbiAgX3NlYXJjaGVzID0gW11cbiAgLyoqXG4gICAqIFNvcnQuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsU29ydFtdfSAqL1xuICBfc29ydCA9IFtdXG4gIC8qKlxuICAgKiBHcm91cC5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxHcm91cFtdfSAqL1xuICBfZ3JvdXAgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbnN0cnVjdG9yIGFyZ3MuXG4gICAqIEBwYXJhbSB7VH0gYXJncy5tb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gW2FyZ3MucHJlbG9hZF0gLSBQcmVsb2FkIG1hcC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttb2RlbENsYXNzLCBwcmVsb2FkID0ge319KSB7XG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWQgPSBub3JtYWxpemVQcmVsb2FkKHByZWxvYWQpXG4gICAgdGhpcy5fam9pbnMgPSB7fVxuICAgIHRoaXMuX3doZXJlID0ge31cbiAgICB0aGlzLl9zZWFyY2hlcyA9IFtdXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gICAgdGhpcy5fc2VsZWN0ID0ge31cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgICB0aGlzLl9zZWxlY3RzRXh0cmEgPSB7fVxuICAgIHRoaXMuX3NvcnQgPSBbXVxuICAgIHRoaXMuX2dyb3VwID0gW11cbiAgICB0aGlzLl9kaXN0aW5jdCA9IGZhbHNlXG4gICAgdGhpcy5fbGltaXQgPSBudWxsXG4gICAgdGhpcy5fb2Zmc2V0ID0gbnVsbFxuICAgIHRoaXMuX3BhZ2UgPSBudWxsXG4gICAgdGhpcy5fcGVyUGFnZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICB0aGlzLl93aXRoQ291bnQgPSBbXVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICB0aGlzLl9xdWVyeURhdGEgPSBbXVxuICAgIC8qKlxuICAgICAqIFBlci1yZWNvcmQgYWJpbGl0eSBzcGVjLiBOb3JtYWxpemVkIHRvIGEgbGlzdCBvZlxuICAgICAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcyDigJQgb25lIGVudHJ5IHBlciBtb2RlbCB0aGF0IHNob3VsZFxuICAgICAqIGhhdmUgYWJpbGl0eSByZXN1bHRzIGF0dGFjaGVkLiBUaGUgcm9vdCBxdWVyeSdzIG1vZGVsIGNsYXNzXG4gICAgICogbmFtZSBpcyBpbXBsaWNpdCB2aWEgYFwiX19yb290X19cImAgd2hlbiB0aGUgY2FsbGVyIHVzZWQgdGhlIGZsYXRcbiAgICAgKiBhcnJheSBmb3JtLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59XG4gICAgICovXG4gICAgdGhpcy5fYWJpbGl0aWVzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBiYWNrZW5kIHRvIGV2YWx1YXRlIG9uZSBvciBtb3JlIGFiaWxpdHkgYWN0aW9ucyBhZ2FpbnN0XG4gICAqIGVhY2ggcmV0dXJuZWQgcmVjb3JkIChhbmQgaXRzIHByZWxvYWRlZCByZWxhdGlvbnMsIHdoZW4ga2V5ZWQgYnlcbiAgICogbW9kZWwgbmFtZSkgYW5kIHNoaXAgdGhlIHJlc3VsdHMgYmFjayBzbyB0aGUgZnJvbnRlbmQgY2FuIHJlYWRcbiAgICogdGhlbSB2aWEgYHJlY29yZC5jYW4oYWN0aW9uKWAuXG4gICAqXG4gICAqIEZsYXQgZm9ybSDigJQgYXBwbGllcyB0byB0aGUgcXVlcnkncyBvd24gbW9kZWwgY2xhc3M6XG4gICAqICAgYGBgXG4gICAqICAgY29uc3QgdGltZWxvZ3MgPSBhd2FpdCBUaW1lbG9nLndoZXJlKHt0YXNrSWR9KVxuICAgKiAgICAgLmFiaWxpdGllcyhbXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdKVxuICAgKiAgICAgLnRvQXJyYXkoKVxuICAgKiAgIHRpbWVsb2dzWzBdLmNhbihcInVwZGF0ZVwiKSAvLyDihpIgYm9vbGVhblxuICAgKiAgIGBgYFxuICAgKlxuICAgKiBLZXllZCBmb3JtIOKAlCB0YXJnZXRzIHJlY29yZHMgYnkgbW9kZWwgbmFtZSwgdXNlZnVsIGZvciBwcmVsb2FkZWRcbiAgICogY2hpbGRyZW46XG4gICAqICAgYGBgXG4gICAqICAgY29uc3QgcHJvamVjdCA9IGF3YWl0IFByb2plY3RcbiAgICogICAgIC5wcmVsb2FkKFwidGltZWxvZ3NcIilcbiAgICogICAgIC5hYmlsaXRpZXMoe1RpbWVsb2c6IFtcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl19KVxuICAgKiAgICAgLmZpcnN0KClcbiAgICogICBwcm9qZWN0LnRpbWVsb2dzKCkubG9hZGVkKClbMF0uY2FuKFwidXBkYXRlXCIpIC8vIOKGkiBib29sZWFuXG4gICAqICAgYGBgXG4gICAqXG4gICAqIEtleXMgaW4gdGhlIGtleWVkIGZvcm0gYXJlIHRoZSBiYWNrZW5kIG1vZGVsIG5hbWVzIChhcyByZXR1cm5lZCBieVxuICAgKiBgTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKWAgLyB0aGUgYG1vZGVsTmFtZWAgZmllbGQgb2YgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGNvbmZpZykuIFZhbHVlcyBhcmUgdGhlIGFiaWxpdHktYWN0aW9uXG4gICAqIHN0cmluZ3Mg4oCUIHR5cGljYWxseSBgXCJ1cGRhdGVcImAgLyBgXCJkZXN0cm95XCJgIC8gYFwiY3JlYXRlXCJgIC9cbiAgICogYFwicmVhZFwiYCwgYnV0IGFueSBjdXN0b20gYWN0aW9uIHJlZ2lzdGVyZWQgb24gdGhlIHJlc291cmNlJ3NcbiAgICogYXV0aG9yaXphdGlvbiBhYmlsaXR5IGlzIGFjY2VwdGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzcGVjIC0gQWJpbGl0eSBhY3Rpb25zIHRvIHJlcXVlc3QgZm9yIHJvb3Qgb3IgbmFtZWQgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5IGZvciBjaGFpbmluZy5cbiAgICovXG4gIGFiaWxpdGllcyhzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVBYmlsaXRpZXNTcGVjKHNwZWMsIHRoaXMubW9kZWxDbGFzcykpIHtcbiAgICAgIHRoaXMuX21lcmdlQWJpbGl0eUVudHJ5KGVudHJ5KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtZXJnZSBhYmlsaXR5IGVudHJ5LlxuICAgKiBAcGFyYW0ge3ttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119fSBlbnRyeSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0IHRvIGFwcGVuZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbWVyZ2VBYmlsaXR5RW50cnkoZW50cnkpIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuX2FiaWxpdGllcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5tb2RlbE5hbWUgPT09IGVudHJ5Lm1vZGVsTmFtZSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX2FiaWxpdGllcy5wdXNoKHthY3Rpb25zOiBbLi4uZW50cnkuYWN0aW9uc10sIG1vZGVsTmFtZTogZW50cnkubW9kZWxOYW1lfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIGVudHJ5LmFjdGlvbnMpIHtcbiAgICAgIGlmICghZXhpc3RpbmcuYWN0aW9ucy5pbmNsdWRlcyhhY3Rpb24pKSBleGlzdGluZy5hY3Rpb25zLnB1c2goYWN0aW9uKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBiYWNrZW5kIGluZGV4IHF1ZXJ5IHRvIGF0dGFjaCBvbmUgb3IgbW9yZSBhc3NvY2lhdGlvblxuICAgKiBjb3VudHMgdG8gZWFjaCByZXR1cm5lZCByZWNvcmQuIFBhcnNlcyB0aGUgc2FtZSBzaGFwZXMgYXMgdGhlXG4gICAqIGJhY2tlbmQgYE1vZGVsQ2xhc3NRdWVyeSN3aXRoQ291bnRgLCB0aGVuIHNoaXBzIHRoZSBub3JtYWxpemVkXG4gICAqIGVudHJpZXMgYXMgcGFydCBvZiB0aGUgYGluZGV4YCBjb21tYW5kIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gc3BlYyAtIFJlbGF0aW9uc2hpcHMgd2hvc2UgY291bnRzIHNob3VsZCBiZSBzZXJpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBUaGlzIHF1ZXJ5IGZvciBjaGFpbmluZy5cbiAgICovXG4gIHdpdGhDb3VudChzcGVjKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVXaXRoQ291bnRGcm9udGVuZChzcGVjKSkge1xuICAgICAgdGhpcy5fd2l0aENvdW50LnB1c2goZW50cnkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0IG9uZSBvciBtb3JlIGJhY2tlbmQgcXVlcnlEYXRhIGVudHJpZXMgZm9yIGVhY2ggcmV0dXJuZWRcbiAgICogcmVjb3JkLiBUaGUgc3BlYyBpcyBhIG5hbWUgb3IgbmVzdGVkLXJlY29yZCBzaGFwZSBtYXRjaGluZyB0aGVcbiAgICogYE1vZGVsLnF1ZXJ5RGF0YShuYW1lLCBmbilgIHJlZ2lzdHJhdGlvbnMgb24gdGhlIGJhY2tlbmQg4oCUIHRoZVxuICAgKiBmcm9udGVuZCBzaGlwcyBvbmx5IHRoZXNlIG5hbWVzOyB0aGUgU1FMIGZyYWdtZW50cyBzdGF5IHNlcnZlci1cbiAgICogc2lkZS4gQWxsIHJlc3VsdGluZyBhbGlhc2VzIGFyZSBhdHRhY2hlZCB0byB0aGUgcm9vdCByZWNvcmQgYW5kXG4gICAqIHJlYWQgYmFjayB3aXRoIGByZWNvcmQucXVlcnlEYXRhKGFsaWFzTmFtZSlgLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEFycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHNwZWMgLSBCYWNrZW5kIHF1ZXJ5LWRhdGEgbmFtZXMgYW5kIGFyZ3VtZW50cyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFRoaXMgcXVlcnkgZm9yIGNoYWluaW5nLlxuICAgKi9cbiAgcXVlcnlEYXRhKHNwZWMpIHtcbiAgICBpZiAoc3BlYyA9PSBudWxsKSByZXR1cm4gdGhpc1xuXG4gICAgdGhpcy5fcXVlcnlEYXRhLnB1c2goLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHNwZWMpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBtZXJnZWQgd2hlcmUgY29uZGl0aW9ucy5cbiAgICovXG4gIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICB0aGlzLm1vZGVsQ2xhc3MuYXNzZXJ0RmluZEJ5Q29uZGl0aW9ucyhjb25kaXRpb25zKVxuXG4gICAgdGhpcy5fd2hlcmUgPSB7XG4gICAgICAuLi50aGlzLl93aGVyZSxcbiAgICAgIC4uLmNvbmRpdGlvbnNcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NvcGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9IHNjb3BlRGVzY3JpcHRvciAtIFNjb3BlIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHNjb3BlKHNjb3BlRGVzY3JpcHRvcikge1xuICAgIGlmICghaXNNb2RlbFNjb3BlRGVzY3JpcHRvcihzY29wZURlc2NyaXB0b3IpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzY29wZSgpIGV4cGVjdHMgYSBkZXNjcmlwdG9yIHJldHVybmVkIGJ5IGRlZmluZVNjb3BlKC4uLikuc2NvcGUoLi4uKVwiKVxuICAgIH1cblxuICAgIGlmIChzY29wZURlc2NyaXB0b3IubW9kZWxDbGFzcyAhPT0gdGhpcy5tb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhcHBseSAke3Njb3BlRGVzY3JpcHRvci5tb2RlbENsYXNzLm5hbWV9IHNjb3BlIHRvICR7dGhpcy5tb2RlbENsYXNzLm5hbWV9IHF1ZXJ5YClcbiAgICB9XG5cbiAgICBjb25zdCBzY29wZWRRdWVyeSA9IC8qKiBAdHlwZSB7dGhpcyB8IHZvaWR9ICovIChzY29wZURlc2NyaXB0b3IuY2FsbGJhY2soe1xuICAgICAgZHJpdmVyOiBudWxsLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgcXVlcnk6IHRoaXMsXG4gICAgICB0YWJsZTogbnVsbFxuICAgIH0sIC4uLnNjb3BlRGVzY3JpcHRvci5zY29wZUFyZ3MpKVxuXG4gICAgcmV0dXJuIHNjb3BlZFF1ZXJ5IHx8IHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLiBTdXBwb3J0cyBgc2Aga2V5IGZvciBzb3J0aW5nIChlLmcuLCBge3M6IFwibmFtZSBhc2NcIn1gKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYW5kIHNvcnQgYXBwbGllZC5cbiAgICovXG4gIHJhbnNhY2socGFyYW1zKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSBwYXJhbXNcbiAgICBjb25zdCBoYXNGaWx0ZXJzID0gT2JqZWN0LmtleXMoZmlsdGVyUGFyYW1zKS5sZW5ndGggPiAwXG5cbiAgICBpZiAoaGFzRmlsdGVycykge1xuICAgICAgbm9ybWFsaXplUmFuc2Fja0dyb3VwKHRoaXMubW9kZWxDbGFzcywgZmlsdGVyUGFyYW1zKVxuICAgICAgdGhpcy5fcmFuc2Fjay5wdXNoKGZpbHRlclBhcmFtcylcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHMgPT09IFwic3RyaW5nXCIgJiYgcy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc29ydHMgPSBwYXJzZVJhbnNhY2tTb3J0KHRoaXMubW9kZWxDbGFzcywgcylcblxuICAgICAgZm9yIChjb25zdCBzb3J0RGVmIG9mIHNvcnRzKSB7XG4gICAgICAgIHRoaXMuc29ydChbW3NvcnREZWYuYXR0cmlidXRlLCBzb3J0RGVmLmRpcmVjdGlvbl1dKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3Qgd2l0aCByZXF1aXJlZCByb290IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFtyZXF1aXJlZEF0dHJpYnV0ZXNdIC0gRXh0cmEgcmVxdWlyZWQgYXR0cmlidXRlcyBmb3IgdGhlIHJvb3QgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IC0gU2VsZWN0IG1hcCB3aXRoIHJlcXVpcmVkIHJvb3QgYXR0cmlidXRlcyBtZXJnZWQgd2hlbiByb290IHNlbGVjdCBleGlzdHMuXG4gICAqL1xuICBzZWxlY3RXaXRoUmVxdWlyZWRSb290QXR0cmlidXRlcyhyZXF1aXJlZEF0dHJpYnV0ZXMgPSBbXSkge1xuICAgIGNvbnN0IHJvb3RNb2RlbE5hbWUgPSB0aGlzLm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCBzZWxlY3RNYXAgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi8gKHRoaXMuX3NlbGVjdClcbiAgICBjb25zdCBleGlzdGluZ1Jvb3RBdHRyaWJ1dGVzID0gc2VsZWN0TWFwW3Jvb3RNb2RlbE5hbWVdXG5cbiAgICBpZiAoIWV4aXN0aW5nUm9vdEF0dHJpYnV0ZXMpIHtcbiAgICAgIHJldHVybiBzZWxlY3RNYXBcbiAgICB9XG5cbiAgICBjb25zdCByb290UHJpbWFyeUtleSA9IHRoaXMubW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5zZWxlY3RNYXAsXG4gICAgICBbcm9vdE1vZGVsTmFtZV06IEFycmF5LmZyb20obmV3IFNldChbcm9vdFByaW1hcnlLZXksIC4uLmV4aXN0aW5nUm9vdEF0dHJpYnV0ZXMsIC4uLnJlcXVpcmVkQXR0cmlidXRlc10pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCB0byBtZXJnZS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBtZXJnZWQgcHJlbG9hZHMuXG4gICAqL1xuICBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICBtZXJnZVByZWxvYWRSZWNvcmQodGhpcy5fcHJlbG9hZCwgbm9ybWFsaXplUHJlbG9hZChwcmVsb2FkKSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IHNlbGVjdCAtIE1vZGVsLWF3YXJlIGF0dHJpYnV0ZSBzZWxlY3QgbWFwIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc2VsZWN0KHNlbGVjdCkge1xuICAgIG1lcmdlU2VsZWN0UmVjb3JkKHRoaXMuX3NlbGVjdCwgbm9ybWFsaXplU2VsZWN0KHNlbGVjdCwgdGhpcy5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogTGlrZSBgc2VsZWN0KC4uLilgLCBidXQga2VlcHMgdGhlIGRlZmF1bHQgc2VyaWFsaXplZCBhdHRyaWJ1dGVzIGFuZCBsb2Fkc1xuICAgKiB0aGUgZ2l2ZW4gZXh0cmFzIGluIGFkZGl0aW9uIChmb3IgZXhhbXBsZSBhdHRyaWJ1dGVzIGRlY2xhcmVkXG4gICAqIGBzZWxlY3RlZEJ5RGVmYXVsdDogZmFsc2VgKS4gS2V5ZWQgYnkgbW9kZWwgbmFtZSwgd2l0aCByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gRXh0cmEgYXR0cmlidXRlcyB0byBsb2FkLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCBleHRyYSBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc2VsZWN0c0V4dHJhKHNlbGVjdCkge1xuICAgIG1lcmdlU2VsZWN0UmVjb3JkKHRoaXMuX3NlbGVjdHNFeHRyYSwgbm9ybWFsaXplU2VsZWN0KHNlbGVjdCwgdGhpcy5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBqb2lucyAtIFJlbGF0aW9uc2hpcCBkZXNjcmlwdG9yIGpvaW5zLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBRdWVyeSB3aXRoIG1lcmdlZCBqb2lucy5cbiAgICovXG4gIGpvaW5zKGpvaW5zKSB7XG4gICAgbWVyZ2VKb2luUmVjb3JkKHRoaXMuX2pvaW5zLCBub3JtYWxpemVKb2lucyhqb2lucykpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNlYXJjaCByZXN1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbiAtIENvbHVtbiBvciBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwifSBvcGVyYXRvciAtIFNlYXJjaCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggYXBwZW5kZWQgc2VhcmNoLlxuICAgKi9cbiAgc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHNlYXJjaCBwYXRoIG11c3QgYmUgYW4gYXJyYXksIGdvdDogJHt0eXBlb2YgcGF0aH1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcGF0aEVudHJ5IG9mIHBhdGgpIHtcbiAgICAgIGlmICh0eXBlb2YgcGF0aEVudHJ5ICE9PSBcInN0cmluZ1wiIHx8IHBhdGhFbnRyeS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcInNlYXJjaCBwYXRoIGVudHJpZXMgbXVzdCBiZSBub24tZW1wdHkgc3RyaW5nc1wiKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY29sdW1uICE9PSBcInN0cmluZ1wiIHx8IGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzZWFyY2ggY29sdW1uIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBvcGVyYXRvciAhPT0gXCJzdHJpbmdcIiB8fCBvcGVyYXRvci5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzZWFyY2ggb3BlcmF0b3IgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkT3BlcmF0b3IgPSBub3JtYWxpemVTZWFyY2hPcGVyYXRvcihvcGVyYXRvcilcblxuICAgIHRoaXMuX3NlYXJjaGVzLnB1c2goe1xuICAgICAgY29sdW1uLFxuICAgICAgb3BlcmF0b3I6IG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgIHBhdGg6IFsuLi5wYXRoXSxcbiAgICAgIHZhbHVlXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggYXBwZW5kZWQgc29ydCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHNvcnQoc29ydCkge1xuICAgIHRoaXMuX3NvcnQucHVzaCguLi5ub3JtYWxpemVTb3J0KHNvcnQpKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IG9yZGVyIC0gT3JkZXIgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBhcHBlbmRlZCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgb3JkZXIob3JkZXIpIHtcbiAgICByZXR1cm4gdGhpcy5zb3J0KG9yZGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ3JvdXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBncm91cCAtIEdyb3VwIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggYXBwZW5kZWQgZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBncm91cChncm91cCkge1xuICAgIHRoaXMuX2dyb3VwLnB1c2goLi4ubm9ybWFsaXplR3JvdXAoZ3JvdXApKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBkaXN0aW5jdCBmbGFnLlxuICAgKi9cbiAgZGlzdGluY3QodmFsdWUgPSB0cnVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZGlzdGluY3QgbXVzdCBiZSBhIGJvb2xlYW4sIGdvdDogJHt0eXBlb2YgdmFsdWV9YClcbiAgICB9XG5cbiAgICB0aGlzLl9kaXN0aW5jdCA9IHZhbHVlXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxpbWl0IHJlc3VsdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBsaW1pdC5cbiAgICovXG4gIGxpbWl0KHZhbHVlKSB7XG4gICAgdGhpcy5fbGltaXQgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQodmFsdWUsIFwibGltaXRcIiwge21pbjogMH0pXG4gICAgdGhpcy5fcGFnZSA9IG51bGxcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvZmZzZXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggb2Zmc2V0LlxuICAgKi9cbiAgb2Zmc2V0KHZhbHVlKSB7XG4gICAgdGhpcy5fb2Zmc2V0ID0gbm9ybWFsaXplSW50ZWdlckFyZ3VtZW50KHZhbHVlLCBcIm9mZnNldFwiLCB7bWluOiAwfSlcbiAgICB0aGlzLl9wYWdlID0gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlTnVtYmVyIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUXVlcnkgd2l0aCBwYWdlIGFwcGxpZWQuXG4gICAqL1xuICBwYWdlKHBhZ2VOdW1iZXIpIHtcbiAgICB0aGlzLl9wYWdlID0gbm9ybWFsaXplSW50ZWdlckFyZ3VtZW50KHBhZ2VOdW1iZXIsIFwicGFnZVwiLCB7bWluOiAxfSlcbiAgICBjb25zdCBwYWdlU2l6ZSA9IHRoaXMuX3BlclBhZ2UgfHwgMzBcblxuICAgIHRoaXMuX2xpbWl0ID0gcGFnZVNpemVcbiAgICB0aGlzLl9vZmZzZXQgPSAodGhpcy5fcGFnZSAtIDEpICogcGFnZVNpemVcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXIgcGFnZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBlclBhZ2UgLSBQYWdlIHNpemUuXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFF1ZXJ5IHdpdGggcGVyLXBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHBlclBhZ2UocGVyUGFnZSkge1xuICAgIHRoaXMuX3BlclBhZ2UgPSBub3JtYWxpemVJbnRlZ2VyQXJndW1lbnQocGVyUGFnZSwgXCJwZXJQYWdlXCIsIHttaW46IDF9KVxuXG4gICAgaWYgKHRoaXMuX3BhZ2UgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuX2xpbWl0ID0gdGhpcy5fcGVyUGFnZVxuICAgICAgdGhpcy5fb2Zmc2V0ID0gKHRoaXMuX3BhZ2UgLSAxKSAqIHRoaXMuX3BlclBhZ2VcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvbmUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gQ2xvbmVkIHF1ZXJ5IGluc3RhbmNlLlxuICAgKi9cbiAgY2xvbmUoKSB7XG4gICAgY29uc3QgbmV3UXVlcnkgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKG5ldyBGcm9udGVuZE1vZGVsUXVlcnkoe1xuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzLFxuICAgICAgcHJlbG9hZDogbm9ybWFsaXplUHJlbG9hZCh0aGlzLl9wcmVsb2FkKVxuICAgIH0pKVxuXG4gICAgbmV3UXVlcnkuX2pvaW5zID0gbm9ybWFsaXplSm9pbnModGhpcy5fam9pbnMpXG4gICAgbmV3UXVlcnkuX3doZXJlID0gey4uLnRoaXMuX3doZXJlfVxuICAgIG5ld1F1ZXJ5Ll9yYW5zYWNrID0gdGhpcy5fcmFuc2Fjay5tYXAoKHJhbnNhY2tQYXJhbXMpID0+ICh7Li4ucmFuc2Fja1BhcmFtc30pKVxuICAgIG5ld1F1ZXJ5Ll9zZWFyY2hlcyA9IHRoaXMuX3NlYXJjaGVzLm1hcCgoc2VhcmNoKSA9PiAoe1xuICAgICAgY29sdW1uOiBzZWFyY2guY29sdW1uLFxuICAgICAgb3BlcmF0b3I6IHNlYXJjaC5vcGVyYXRvcixcbiAgICAgIHBhdGg6IFsuLi5zZWFyY2gucGF0aF0sXG4gICAgICB2YWx1ZTogc2VhcmNoLnZhbHVlXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX3NlbGVjdCA9IG5vcm1hbGl6ZVNlbGVjdCh0aGlzLl9zZWxlY3QpXG4gICAgbmV3UXVlcnkuX3NlbGVjdHNFeHRyYSA9IG5vcm1hbGl6ZVNlbGVjdCh0aGlzLl9zZWxlY3RzRXh0cmEpXG4gICAgbmV3UXVlcnkuX3NvcnQgPSB0aGlzLl9zb3J0Lm1hcCgoc29ydEVudHJ5KSA9PiAoe1xuICAgICAgY29sdW1uOiBzb3J0RW50cnkuY29sdW1uLFxuICAgICAgZGlyZWN0aW9uOiBzb3J0RW50cnkuZGlyZWN0aW9uLFxuICAgICAgcGF0aDogWy4uLnNvcnRFbnRyeS5wYXRoXVxuICAgIH0pKVxuICAgIG5ld1F1ZXJ5Ll9ncm91cCA9IHRoaXMuX2dyb3VwLm1hcCgoZ3JvdXBFbnRyeSkgPT4gKHtcbiAgICAgIGNvbHVtbjogZ3JvdXBFbnRyeS5jb2x1bW4sXG4gICAgICBwYXRoOiBbLi4uZ3JvdXBFbnRyeS5wYXRoXVxuICAgIH0pKVxuICAgIG5ld1F1ZXJ5Ll9kaXN0aW5jdCA9IHRoaXMuX2Rpc3RpbmN0XG4gICAgbmV3UXVlcnkuX2xpbWl0ID0gdGhpcy5fbGltaXRcbiAgICBuZXdRdWVyeS5fb2Zmc2V0ID0gdGhpcy5fb2Zmc2V0XG4gICAgbmV3UXVlcnkuX3BhZ2UgPSB0aGlzLl9wYWdlXG4gICAgbmV3UXVlcnkuX3BlclBhZ2UgPSB0aGlzLl9wZXJQYWdlXG4gICAgbmV3UXVlcnkuX3dpdGhDb3VudCA9IHRoaXMuX3dpdGhDb3VudC5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgYXR0cmlidXRlTmFtZTogZW50cnkuYXR0cmlidXRlTmFtZSxcbiAgICAgIHJlbGF0aW9uc2hpcE5hbWU6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICB3aGVyZTogZW50cnkud2hlcmUgPyB7Li4uZW50cnkud2hlcmV9IDogdW5kZWZpbmVkXG4gICAgfSkpXG4gICAgbmV3UXVlcnkuX3F1ZXJ5RGF0YSA9IHRoaXMuX3F1ZXJ5RGF0YS5tYXAoKGVudHJ5KSA9PiAoXG4gICAgICB0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIgPyBlbnRyeSA6IHsuLi5lbnRyeX1cbiAgICApKVxuICAgIG5ld1F1ZXJ5Ll9hYmlsaXRpZXMgPSB0aGlzLl9hYmlsaXRpZXMubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgIGFjdGlvbnM6IFsuLi5lbnRyeS5hY3Rpb25zXSxcbiAgICAgIG1vZGVsTmFtZTogZW50cnkubW9kZWxOYW1lXG4gICAgfSkpXG5cbiAgICByZXR1cm4gbmV3UXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1R9IC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgcHJlbG9hZCBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHByZWxvYWRQYXlsb2FkKCkge1xuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl9wcmVsb2FkKS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtwcmVsb2FkOiB0aGlzLl9wcmVsb2FkfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb3VudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgd2l0aENvdW50IGFycmF5IHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHdpdGhDb3VudFBheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX3dpdGhDb3VudC5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHdpdGhDb3VudDogdGhpcy5fd2l0aENvdW50Lm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IGVudHJ5LmF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWU6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgIHdoZXJlOiBlbnRyeS53aGVyZSB8fCB1bmRlZmluZWRcbiAgICAgIH0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFiaWxpdGllcyBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgYWJpbGl0aWVzIGFycmF5IHdoZW4gcHJlc2VudC5cbiAgICovXG4gIGFiaWxpdGllc1BheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX2FiaWxpdGllcy5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdGllczogdGhpcy5fYWJpbGl0aWVzLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIGFjdGlvbnM6IFsuLi5lbnRyeS5hY3Rpb25zXSxcbiAgICAgICAgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWVcbiAgICAgIH0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGRhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHF1ZXJ5RGF0YSBzcGVjIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHF1ZXJ5RGF0YVBheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXJ5RGF0YS5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgLy8gU2luZ2xlIGFjY3VtdWxhdGVkIHNwZWMgZ29lcyBvbiB0aGUgd2lyZSB2ZXJiYXRpbS4gVGhlIGJhY2tlbmRcbiAgICAvLyBub3JtYWxpemVyIGFjY2VwdHMgc3RyaW5nL2FycmF5L29iamVjdCBhdCBlYWNoIGxldmVsLCBzbyB3ZSBjYW5cbiAgICAvLyBzaGlwIG11bHRpcGxlIGAucXVlcnlEYXRhKC4uLilgIGNhbGxzIGFzIGFuIGFycmF5LlxuICAgIHJldHVybiB7XG4gICAgICBxdWVyeURhdGE6IHRoaXMuX3F1ZXJ5RGF0YS5sZW5ndGggPT09IDEgPyB0aGlzLl9xdWVyeURhdGFbMF0gOiB0aGlzLl9xdWVyeURhdGFcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW3JlcXVpcmVkQXR0cmlidXRlc10gLSBFeHRyYSByZXF1aXJlZCBhdHRyaWJ1dGVzIGZvciByb290IG1vZGVsIHNlbGVjdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHNlbGVjdCBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHNlbGVjdFBheWxvYWQocmVxdWlyZWRBdHRyaWJ1dGVzID0gW10pIHtcbiAgICBjb25zdCBzZWxlY3QgPSB0aGlzLnNlbGVjdFdpdGhSZXF1aXJlZFJvb3RBdHRyaWJ1dGVzKHJlcXVpcmVkQXR0cmlidXRlcylcblxuICAgIGlmIChPYmplY3Qua2V5cyhzZWxlY3QpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge3NlbGVjdH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHNlbGVjdHNFeHRyYSBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHNlbGVjdHNFeHRyYVBheWxvYWQoKSB7XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3NlbGVjdHNFeHRyYSkubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7c2VsZWN0c0V4dHJhOiB0aGlzLl9zZWxlY3RzRXh0cmF9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2ggcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHNlYXJjaGVzIGFycmF5IHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHNlYXJjaFBheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX3NlYXJjaGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2VhcmNoZXM6IHRoaXMuX3NlYXJjaGVzLm1hcCgoc2VhcmNoKSA9PiAoe1xuICAgICAgICBjb2x1bW46IHNlYXJjaC5jb2x1bW4sXG4gICAgICAgIG9wZXJhdG9yOiBzZWFyY2gub3BlcmF0b3IsXG4gICAgICAgIHBhdGg6IFsuLi5zZWFyY2gucGF0aF0sXG4gICAgICAgIHZhbHVlOiBzZWFyY2gudmFsdWVcbiAgICAgIH0pKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2sgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHJhbnNhY2sgaGFzaCB3aGVuIHByZXNlbnQuXG4gICAqL1xuICByYW5zYWNrUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fcmFuc2Fjay5sZW5ndGggPT09IDApIHJldHVybiB7fVxuXG4gICAgaWYgKHRoaXMuX3JhbnNhY2subGVuZ3RoID09PSAxKSB7XG4gICAgICByZXR1cm4ge3JhbnNhY2s6IHRoaXMuX3JhbnNhY2tbMF19XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJhbnNhY2s6IHtcbiAgICAgICAgZzogdGhpcy5fcmFuc2FjayxcbiAgICAgICAgbTogXCJhbmRcIlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBqb2lucyBoYXNoIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIGpvaW5zUGF5bG9hZCgpIHtcbiAgICBpZiAoT2JqZWN0LmtleXModGhpcy5fam9pbnMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgam9pbnM6IG5vcm1hbGl6ZUpvaW5zKHRoaXMuX2pvaW5zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNvcnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHNvcnQgYXJyYXkgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgc29ydFBheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMuX3NvcnQubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBzb3J0OiB0aGlzLl9zb3J0Lm1hcCgoc29ydEVudHJ5KSA9PiAoe1xuICAgICAgICBjb2x1bW46IHNvcnRFbnRyeS5jb2x1bW4sXG4gICAgICAgIGRpcmVjdGlvbjogc29ydEVudHJ5LmRpcmVjdGlvbixcbiAgICAgICAgcGF0aDogWy4uLnNvcnRFbnRyeS5wYXRoXVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ3JvdXAgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIGdyb3VwIGFycmF5IHdoZW4gcHJlc2VudC5cbiAgICovXG4gIGdyb3VwUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5fZ3JvdXAubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBncm91cDogdGhpcy5fZ3JvdXAubWFwKChncm91cEVudHJ5KSA9PiAoe1xuICAgICAgICBjb2x1bW46IGdyb3VwRW50cnkuY29sdW1uLFxuICAgICAgICBwYXRoOiBbLi4uZ3JvdXBFbnRyeS5wYXRoXVxuICAgICAgfSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIGRpc3RpbmN0IGZsYWcgd2hlbiBlbmFibGVkLlxuICAgKi9cbiAgZGlzdGluY3RQYXlsb2FkKCkge1xuICAgIGlmICghdGhpcy5fZGlzdGluY3QpIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRpc3RpbmN0OiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHdoZXJlIGhhc2ggd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgd2hlcmVQYXlsb2FkKCkge1xuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl93aGVyZSkubGVuZ3RoID09PSAwKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICB3aGVyZTogdGhpcy5fd2hlcmVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdpbmF0aW9uIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCBwYWdpbmF0aW9uIHBhcmFtcyB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBwYWdpbmF0aW9uUGF5bG9hZCgpIHtcbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBpZiAodGhpcy5fbGltaXQgIT09IG51bGwpIHBheWxvYWQubGltaXQgPSB0aGlzLl9saW1pdFxuICAgIGlmICh0aGlzLl9vZmZzZXQgIT09IG51bGwpIHBheWxvYWQub2Zmc2V0ID0gdGhpcy5fb2Zmc2V0XG4gICAgaWYgKHRoaXMuX3BhZ2UgIT09IG51bGwpIHBheWxvYWQucGFnZSA9IHRoaXMuX3BhZ2VcbiAgICBpZiAodGhpcy5fcGVyUGFnZSAhPT0gbnVsbCkgcGF5bG9hZC5wZXJQYWdlID0gdGhpcy5fcGVyUGFnZVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBldmVudCBxdWVyeSBzdXBwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKiBAdGhyb3dzIHtFcnJvcn0gV2hlbiB0aGUgcXVlcnkgY29udGFpbnMgbGlzdC1vbmx5IG9wdGlvbnMgdGhhdCBjYW5ub3QgZmlsdGVyIGEgc2luZ2xlIGxpZmVjeWNsZSBldmVudC5cbiAgICovXG4gIGFzc2VydEV2ZW50UXVlcnlTdXBwb3J0ZWQoKSB7XG4gICAgLyoqXG4gICAgICogVW5zdXBwb3J0ZWQgb3B0aW9ucy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgdW5zdXBwb3J0ZWRPcHRpb25zID0gW11cblxuICAgIGlmICh0aGlzLl9zb3J0Lmxlbmd0aCA+IDApIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwic29ydFwiKVxuICAgIGlmICh0aGlzLl9ncm91cC5sZW5ndGggPiAwKSB1bnN1cHBvcnRlZE9wdGlvbnMucHVzaChcImdyb3VwXCIpXG4gICAgaWYgKHRoaXMuX2Rpc3RpbmN0KSB1bnN1cHBvcnRlZE9wdGlvbnMucHVzaChcImRpc3RpbmN0XCIpXG4gICAgaWYgKHRoaXMuX3JhbnNhY2subGVuZ3RoID4gMCkgdW5zdXBwb3J0ZWRPcHRpb25zLnB1c2goXCJyYW5zYWNrXCIpXG4gICAgaWYgKHRoaXMuX2xpbWl0ICE9PSBudWxsIHx8IHRoaXMuX29mZnNldCAhPT0gbnVsbCB8fCB0aGlzLl9wYWdlICE9PSBudWxsIHx8IHRoaXMuX3BlclBhZ2UgIT09IG51bGwpIHVuc3VwcG9ydGVkT3B0aW9ucy5wdXNoKFwicGFnaW5hdGlvblwiKVxuXG4gICAgaWYgKHVuc3VwcG9ydGVkT3B0aW9ucy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudCBxdWVyaWVzIGRvIG5vdCBzdXBwb3J0ICR7dW5zdXBwb3J0ZWRPcHRpb25zLmpvaW4oXCIsIFwiKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgcHJvamVjdGlvbiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAtIFByb2plY3Rpb24gcGF5bG9hZCB1c2VkIHdoZW4gc2VyaWFsaXppbmcgbGlmZWN5Y2xlIGV2ZW50cy5cbiAgICovXG4gIGV2ZW50UHJvamVjdGlvblBheWxvYWQoKSB7XG4gICAgdGhpcy5hc3NlcnRFdmVudFF1ZXJ5U3VwcG9ydGVkKClcblxuICAgIHJldHVybiB7XG4gICAgICAuLi50aGlzLnByZWxvYWRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlbGVjdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0c0V4dHJhUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy53aXRoQ291bnRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmFiaWxpdGllc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucXVlcnlEYXRhUGF5bG9hZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlbnQgZmlsdGVyIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkIHwgbnVsbH0gLSBRdWVyeSBwaWVjZXMgdXNlZCB0byBtYXRjaCBsaWZlY3ljbGUgZXZlbnRzLlxuICAgKi9cbiAgZXZlbnRGaWx0ZXJQYXlsb2FkKCkge1xuICAgIHRoaXMuYXNzZXJ0RXZlbnRRdWVyeVN1cHBvcnRlZCgpXG5cbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy53aGVyZVBheWxvYWQoKVxuICAgIH1cblxuICAgIHJldHVybiBPYmplY3Qua2V5cyhwYXlsb2FkKS5sZW5ndGggPT09IDAgPyBudWxsIDogcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGV2ZW50T3B0aW9uc1BheWxvYWQgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWR9IC0gQ29tYmluZWQgZXZlbnQgZmlsdGVyIGFuZCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gICAqL1xuICBldmVudE9wdGlvbnNQYXlsb2FkKCkge1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyUGF5bG9hZCA9IHRoaXMuZXZlbnRGaWx0ZXJQYXlsb2FkKClcblxuICAgIHJldHVybiB7XG4gICAgICBldmVudEZpbHRlcktleTogZXZlbnRGaWx0ZXJQYXlsb2FkID8gZnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyS2V5KGV2ZW50RmlsdGVyUGF5bG9hZCkgOiBudWxsLFxuICAgICAgZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgcHJvamVjdGlvblBheWxvYWQ6IHRoaXMuZXZlbnRQcm9qZWN0aW9uUGF5bG9hZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiaW5kZXhcIiwge1xuICAgICAgLi4udGhpcy5wcmVsb2FkUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucmFuc2Fja1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWxlY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlbGVjdHNFeHRyYVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZ3JvdXBQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmRpc3RpbmN0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zb3J0UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy53aGVyZVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2l0aENvdW50UGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5hYmlsaXRpZXNQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnF1ZXJ5RGF0YVBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMucGFnaW5hdGlvblBheWxvYWQoKVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsc0RhdGEgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLm1vZGVscykgPyByZXNwb25zZS5tb2RlbHMgOiBbXVxuICAgIC8qKlxuICAgICAqIE1vZGVscy5cbiAgICAgKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+W119ICovXG4gICAgY29uc3QgbW9kZWxzID0gbW9kZWxzRGF0YS5tYXAoKG1vZGVsKSA9PiB0aGlzLm1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UobW9kZWwpKVxuXG4gICAgLy8gU2hhcmUgYSBzaW5nbGUgY29ob3J0IHJlZmVyZW5jZSBhY3Jvc3MgZXZlcnkgc2libGluZyBzbyBhdXRvLWJhdGNoLXByZWxvYWRcbiAgICAvLyBjYW4gYmF0Y2ggbGF6eSByZWxhdGlvbnNoaXAgYWNjZXNzIGxhdGVyLiBTaW5nbGUtcmVjb3JkIGxvb2t1cHMgc3RpbGwgZmxvd1xuICAgIC8vIHRocm91Z2ggaGVyZSAod2l0aCBhIGNvaG9ydCBvZiBvbmUpIGFuZCBkZWdyYWRlIGNsZWFubHkgdG8gcGVyLXJlY29yZCBsb2FkLlxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobW9kZWwpLl9sb2FkQ29ob3J0ID0gbW9kZWxzXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJpbmRleFwiLCB7XG4gICAgICAuLi50aGlzLmpvaW5zUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5yYW5zYWNrUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5zZWFyY2hQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMud2hlcmVQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnBhZ2luYXRpb25QYXlsb2FkKCksXG4gICAgICBjb3VudDogdHJ1ZVxuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHJlc3BvbnNlLmNvdW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBudW1lcmljIGNvdW50IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2UuY291bnR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBtYXRjaGluZyBxdWVyeS5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5jbG9uZSgpXG5cbiAgICBpZiAocXVlcnkuX3NvcnQubGVuZ3RoIDwgMSkge1xuICAgICAgcXVlcnkuc29ydChbW3RoaXMubW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIFwiYXNjXCJdXSlcbiAgICB9XG5cbiAgICBxdWVyeS5saW1pdCgxKVxuXG4gICAgY29uc3QgbW9kZWxzID0gYXdhaXQgcXVlcnkudG9BcnJheSgpXG5cbiAgICByZXR1cm4gbW9kZWxzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgbWF0Y2hpbmcgcXVlcnkuXG4gICAqL1xuICBhc3luYyBsYXN0KCkge1xuICAgIC8vIFdoZW4gcGFnaW5hdGlvbiBpcyBhbHJlYWR5IGFwcGxpZWQsIGZldGNoIHRoYXQgc2NvcGVkIHdpbmRvdyBhbmQgcmV0dXJuIGl0cyBsYXN0IGl0ZW0uXG4gICAgaWYgKHRoaXMuX29mZnNldCAhPT0gbnVsbCB8fCB0aGlzLl9wYWdlICE9PSBudWxsIHx8IHRoaXMuX3BlclBhZ2UgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMudG9BcnJheSgpXG5cbiAgICAgIGlmIChtb2RlbHMubGVuZ3RoIDwgMSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIG1vZGVsc1ttb2RlbHMubGVuZ3RoIC0gMV1cbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuY2xvbmUoKVxuXG4gICAgaWYgKHF1ZXJ5Ll9zb3J0Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHF1ZXJ5LnNvcnQoW1t0aGlzLm1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBcImRlc2NcIl1dKVxuICAgIH0gZWxzZSB7XG4gICAgICBxdWVyeS5fc29ydCA9IHF1ZXJ5Ll9zb3J0Lm1hcCgoc29ydEVudHJ5KSA9PiAoe1xuICAgICAgICAuLi5zb3J0RW50cnksXG4gICAgICAgIGRpcmVjdGlvbjogcmV2ZXJzZVNvcnREaXJlY3Rpb24oc29ydEVudHJ5LmRpcmVjdGlvbilcbiAgICAgIH0pKVxuICAgIH1cblxuICAgIHF1ZXJ5LmxpbWl0KDEpXG5cbiAgICBjb25zdCBtb2RlbHMgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcblxuICAgIHJldHVybiBtb2RlbHNbMF0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgYXN5bmMgcGx1Y2soLi4uY29sdW1ucykge1xuICAgIGlmIChjb2x1bW5zLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbHVtbnMgZ2l2ZW4gdG8gcGx1Y2tcIilcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkUGx1Y2sgPSBub3JtYWxpemVQbHVjayhjb2x1bW5zLmxlbmd0aCA9PT0gMSA/IGNvbHVtbnNbMF0gOiBjb2x1bW5zKVxuICAgIGNvbnN0IGFsbG93ZWRQbHVjayA9IGFzc2VydFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHtcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcyxcbiAgICAgIHBsdWNrOiBub3JtYWxpemVkUGx1Y2tcbiAgICB9KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiaW5kZXhcIiwge1xuICAgICAgLi4udGhpcy5qb2luc1BheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VhcmNoUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5ncm91cFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuZGlzdGluY3RQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNvcnRQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLndoZXJlUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5wYWdpbmF0aW9uUGF5bG9hZCgpLFxuICAgICAgcGx1Y2s6IGFsbG93ZWRQbHVja1xuICAgIH0pXG5cbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS52YWx1ZXMpKSB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2UudmFsdWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRm91bmQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kKGlkKSB7XG4gICAgY29uc3QgcGsgPSB0aGlzLm1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZpbmRCeSh7W3BrXTogaWR9KVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gbm90IGZvdW5kIHdpdGggJHtwa309JHtpZH1gKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGb3VuZCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29uZGl0aW9ucyA9IHRoaXMudmFsaWRhdGVkU3RydWN0dXJlZENvbmRpdGlvbnMoY29uZGl0aW9ucylcbiAgICBjb25zdCBtZXJnZWRXaGVyZSA9IHtcbiAgICAgIC4uLnRoaXMuX3doZXJlLFxuICAgICAgLi4ubm9ybWFsaXplZENvbmRpdGlvbnNcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImluZGV4XCIsIHtcbiAgICAgIC4uLnRoaXMucHJlbG9hZFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuam9pbnNQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLnNlYXJjaFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc2VsZWN0UGF5bG9hZChPYmplY3Qua2V5cyhtZXJnZWRXaGVyZSkpLFxuICAgICAgLi4udGhpcy5zZWxlY3RzRXh0cmFQYXlsb2FkKCksXG4gICAgICAuLi50aGlzLmdyb3VwUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5kaXN0aW5jdFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuc29ydFBheWxvYWQoKSxcbiAgICAgIC4uLnRoaXMuYWJpbGl0aWVzUGF5bG9hZCgpLFxuICAgICAgLi4udGhpcy5wYWdpbmF0aW9uUGF5bG9hZCgpLFxuICAgICAgd2hlcmU6IG1lcmdlZFdoZXJlXG4gICAgfSlcblxuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCByZXNwb25zZSBidXQgZ290OiAke3Jlc3BvbnNlfWApXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5tb2RlbHMpID8gcmVzcG9uc2UubW9kZWxzIDogW11cblxuICAgIGZvciAoY29uc3QgbW9kZWxEYXRhIG9mIG1vZGVscykge1xuICAgICAgY29uc3QgbW9kZWwgPSB0aGlzLm1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UobW9kZWxEYXRhKVxuXG4gICAgICBpZiAodGhpcy5tb2RlbENsYXNzLm1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBtZXJnZWRXaGVyZSkpIHtcbiAgICAgICAgcmV0dXJuIG1vZGVsXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEZvdW5kIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZmluZEJ5KGNvbmRpdGlvbnMpXG5cbiAgICBpZiAoIW1vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZCBmb3IgY29uZGl0aW9uczogJHtzZXJpYWxpemVGaW5kQ29uZGl0aW9ucyhjb25kaXRpb25zKX1gKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgaW5pdGlhbGl6ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucykge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRDb25kaXRpb25zID0gdGhpcy52YWxpZGF0ZWRTdHJ1Y3R1cmVkQ29uZGl0aW9ucyhjb25kaXRpb25zKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5maW5kQnkoY29uZGl0aW9ucylcblxuICAgIGlmIChtb2RlbCkgcmV0dXJuIG1vZGVsXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KSA9PiBJbnN0YW5jZVR5cGU8VD59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MpKVxuXG4gICAgcmV0dXJuIG5ldyBNb2RlbENsYXNzKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKG5vcm1hbGl6ZWRDb25kaXRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KG1vZGVsOiBJbnN0YW5jZVR5cGU8VD4pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBbY2FsbGJhY2tdIC0gT3B0aW9uYWwgY2FsbGJhY2sgYmVmb3JlIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbmRpdGlvbnMgPSB0aGlzLnZhbGlkYXRlZFN0cnVjdHVyZWRDb25kaXRpb25zKGNvbmRpdGlvbnMpXG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZpbmRCeShjb25kaXRpb25zKVxuXG4gICAgaWYgKG1vZGVsKSByZXR1cm4gbW9kZWxcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMubW9kZWxDbGFzcykpXG4gICAgY29uc3QgbmV3TW9kZWwgPSBuZXcgTW9kZWxDbGFzcygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChub3JtYWxpemVkQ29uZGl0aW9ucykpXG5cbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKG5ld01vZGVsKVxuICAgIH1cblxuICAgIGF3YWl0IG5ld01vZGVsLnNhdmUoKVxuXG4gICAgcmV0dXJuIG5ld01vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyB2YWxpZGF0ZWQgc3RydWN0dXJlZCBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIENhbmRpZGF0ZSBzdHJ1Y3R1cmVkIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVmFsaWRhdGVkIGNvbmRpdGlvbnMuXG4gICAqL1xuICB2YWxpZGF0ZWRTdHJ1Y3R1cmVkQ29uZGl0aW9ucyhjb25kaXRpb25zKSB7XG4gICAgdGhpcy5tb2RlbENsYXNzLmFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucylcblxuICAgIHJldHVybiBjb25kaXRpb25zXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IGZpbHRlciBrZXkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWR9IHBheWxvYWQgLSBFdmVudCBmaWx0ZXIgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgZXZlbnQgZmlsdGVyIG1hdGNoaW5nLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJLZXkocGF5bG9hZCkge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocGF5bG9hZClcbn1cblxuLyoqXG4gKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSBxdWVyeSAtIFF1ZXJ5IHJlY2VpdmluZyBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9uc30gb3B0aW9ucyAtIFByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUZyb250ZW5kTW9kZWxQcm9qZWN0aW9uT3B0aW9ucyhxdWVyeSwgb3B0aW9ucykge1xuICBpZiAob3B0aW9ucy5zZWxlY3QgIT09IHVuZGVmaW5lZCkgcXVlcnkuc2VsZWN0KG9wdGlvbnMuc2VsZWN0KVxuICBpZiAob3B0aW9ucy5zZWxlY3RzRXh0cmEgIT09IHVuZGVmaW5lZCkgcXVlcnkuc2VsZWN0c0V4dHJhKG9wdGlvbnMuc2VsZWN0c0V4dHJhKVxuICBpZiAob3B0aW9ucy5wcmVsb2FkICE9PSB1bmRlZmluZWQpIHF1ZXJ5LnByZWxvYWQob3B0aW9ucy5wcmVsb2FkKVxuICBpZiAob3B0aW9ucy53aXRoQ291bnQgIT09IHVuZGVmaW5lZCkgcXVlcnkud2l0aENvdW50KG9wdGlvbnMud2l0aENvdW50KVxuICBpZiAob3B0aW9ucy5hYmlsaXRpZXMgIT09IHVuZGVmaW5lZCkgcXVlcnkuYWJpbGl0aWVzKG9wdGlvbnMuYWJpbGl0aWVzKVxuICBpZiAob3B0aW9ucy5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCkgcXVlcnkucXVlcnlEYXRhKG9wdGlvbnMucXVlcnlEYXRhKVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJ5IGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gcXVlcnkgLSBFdmVudCBxdWVyeS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeUNsYXNzKG1vZGVsQ2xhc3MsIHF1ZXJ5KSB7XG4gIGlmIChxdWVyeS5tb2RlbENsYXNzID09PSBtb2RlbENsYXNzKSByZXR1cm5cblxuICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzdWJzY3JpYmUgJHttb2RlbENsYXNzLm5hbWV9IGV2ZW50cyB3aXRoIGEgJHtxdWVyeS5tb2RlbENsYXNzLm5hbWV9IHF1ZXJ5YClcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIENhbmRpZGF0ZSBldmVudCBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3Qob3B0aW9ucykge1xuICBpZiAob3B0aW9ucyAmJiB0eXBlb2Ygb3B0aW9ucyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSkgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb25zIG11c3QgYmUgYSBxdWVyeSBvciBhbiBvcHRpb25zIG9iamVjdCwgZ290OiAke29wdGlvbnN9YClcbn1cblxuLyoqXG4gKiBSdW5zIGNsb25lZCBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUXVlcnk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzcz59IHF1ZXJ5IC0gRXZlbnQgcXVlcnkuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAtIENsb25lZCBxdWVyeSB1c2VkIGJ5IGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGNsb25lZEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5KG1vZGVsQ2xhc3MsIHF1ZXJ5KSB7XG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5Q2xhc3MobW9kZWxDbGFzcywgcXVlcnkpXG5cbiAgcmV0dXJuIHF1ZXJ5LmNsb25lKClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IHF1ZXJ5IGZyb20gb3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMgb2JqZWN0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzPn0gLSBRdWVyeSB1c2VkIGJ5IGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5RnJvbU9wdGlvbnNPYmplY3QobW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBpZiAob3B0aW9ucy5xdWVyeSAhPT0gdW5kZWZpbmVkICYmICEob3B0aW9ucy5xdWVyeSBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxRdWVyeSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBvcHRpb24gcXVlcnkgbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxRdWVyeVwiKVxuICB9XG5cbiAgY29uc3QgcXVlcnkgPSBvcHRpb25zLnF1ZXJ5XG4gICAgPyBvcHRpb25zLnF1ZXJ5LmNsb25lKClcbiAgICA6IG5ldyBGcm9udGVuZE1vZGVsUXVlcnkoe21vZGVsQ2xhc3N9KVxuXG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5Q2xhc3MobW9kZWxDbGFzcywgcXVlcnkpXG5cbiAgcmV0dXJuIHF1ZXJ5XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBxdWVyeS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3M+fSAtIE5vcm1hbGl6ZWQgcXVlcnkgdXNlZCBieSBldmVudCBzdWJzY3JpcHRpb25zLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKG9wdGlvbnMgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsUXVlcnkpIHJldHVybiBjbG9uZWRGcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gIGFzc2VydEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3Qob3B0aW9ucylcblxuICBjb25zdCBvcHRpb25zT2JqZWN0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSAqLyAob3B0aW9ucylcbiAgY29uc3QgcXVlcnkgPSBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeUZyb21PcHRpb25zT2JqZWN0KG1vZGVsQ2xhc3MsIG9wdGlvbnNPYmplY3QpXG5cbiAgYXBwbHlGcm9udGVuZE1vZGVsUHJvamVjdGlvbk9wdGlvbnMocXVlcnksIG9wdGlvbnNPYmplY3QpXG5cbiAgcmV0dXJuIHF1ZXJ5XG59XG5cbi8qKlxuICogUnVucyB0aGUgZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQgaGVscGVyLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZH0gLSBOb3JtYWxpemVkIGV2ZW50IHN1YnNjcmlwdGlvbiBwYXlsb2FkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQobW9kZWxDbGFzcywgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmcm9udGVuZE1vZGVsRXZlbnRRdWVyeShtb2RlbENsYXNzLCBvcHRpb25zKS5ldmVudE9wdGlvbnNQYXlsb2FkKClcbn1cbiJdfQ==