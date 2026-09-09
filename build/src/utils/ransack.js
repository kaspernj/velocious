// @ts-check
import * as inflection from "inflection";
import { isPlainObject } from "is-plain-object";
import { resolveFrontendModelClass } from "../frontend-models/model-registry.js";
/**
 * RansackPredicate type.
 * @typedef {"cont" | "end" | "eq" | "gt" | "gteq" | "in" | "lt" | "lteq" | "not_eq" | "not_in" | "null" | "start"} RansackPredicate
 */
/**
 * RansackCombinator type.
 * @typedef {"and" | "or"} RansackCombinator
 */
/**
 * RansackModelClass type.
 * @typedef {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} RansackModelClass
 */
/**
 * RansackAttribute type.
 * @typedef {object} RansackAttribute
 * @property {string} attributeName - Resolved attribute name.
 * @property {string[]} path - Resolved relationship path.
 */
/**
 * RansackCondition type.
 * @typedef {object} RansackCondition
 * @property {RansackAttribute[]} attributes - Resolved attributes to test.
 * @property {RansackCombinator} combinator - How multiple attributes are combined.
 * @property {RansackPredicate} predicate - Parsed Ransack predicate.
 * @property {ReturnType<typeof JSON.parse>} value - Normalized value.
 */
/**
 * RansackGroup type.
 * @typedef {object} RansackGroup
 * @property {RansackCombinator} combinator - How entries inside this group are combined.
 * @property {RansackCondition[]} conditions - Conditions in this group.
 * @property {RansackGroup[]} groupings - Nested groups.
 */
/**
 * RansackSort type.
 * @typedef {object} RansackSort
 * @property {string} attribute - Resolved attribute name.
 * @property {"asc" | "desc"} direction - Sort direction.
 */
/** Error raised when a Ransack descriptor is malformed. */
export class RansackQueryError extends Error {
    /**
     * Creates a Ransack query error.
     * @param {string} message - Error message.
     */
    constructor(message) {
        super(message);
        this.name = "RansackQueryError";
    }
}
/**
 * Builds a Ransack query error.
 * @param {string} message - Error message.
 * @returns {RansackQueryError} - Ransack query error.
 */
function ransackQueryError(message) {
    return new RansackQueryError(message);
}
const supportedPredicates = [
    "not_in",
    "not_eq",
    "gteq",
    "lteq",
    "start",
    "cont",
    "null",
    "end",
    "eq",
    "gt",
    "lt",
    "in"
];
/**
 * Runs the normalizeRansackParams helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
export function normalizeRansackParams(modelClass, params) {
    return normalizeRansackGroup(modelClass, params).conditions;
}
/**
 * Runs the normalizeRansackGroup helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
 * @returns {RansackGroup} - Normalized group.
 */
export function normalizeRansackGroup(modelClass, params) {
    if (!isPlainObject(params)) {
        throw ransackQueryError(`ransack params must be a plain object, got: ${typeof params}`);
    }
    /**
     * Normalized.
     * @type {RansackGroup} */
    const normalized = {
        combinator: normalizeRansackCombinator(params.m, "and"),
        conditions: [],
        groupings: []
    };
    for (const [key, rawValue] of Object.entries(params)) {
        if (key === "m") {
            continue;
        }
        if (key === "c") {
            normalized.conditions.push(...normalizeAdvancedRansackConditions({ modelClass, value: rawValue }));
            continue;
        }
        if (key === "g") {
            normalized.groupings.push(...normalizeAdvancedRansackGroups({ modelClass, value: rawValue }));
            continue;
        }
        const condition = normalizeSimpleRansackCondition({ key, modelClass, rawValue });
        if (condition)
            normalized.conditions.push(condition);
    }
    return normalized;
}
const SKIP_RANSACK_CONDITION = Symbol("skip-ransack-condition");
/**
 * Runs normalize simple ransack condition.
 * @param {object} args - Options.
 * @param {string} args.key - Simple Ransack key.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {ReturnType<typeof JSON.parse>} args.rawValue - Raw condition value.
 * @returns {RansackCondition | null} - Normalized condition, or null when skipped.
 */
function normalizeSimpleRansackCondition({ key, modelClass, rawValue }) {
    const parsedKey = parseRansackKey(key);
    if (!parsedKey) {
        throw ransackQueryError(`Unsupported ransack predicate in key: ${key}`);
    }
    const value = normalizeRansackValue({
        predicate: parsedKey.predicate,
        value: rawValue
    });
    if (value === SKIP_RANSACK_CONDITION)
        return null;
    const attributes = resolveRansackAttributes({ modelClass, value: parsedKey.pathValue });
    return {
        attributes,
        combinator: attributes.length > 1 ? "or" : "and",
        predicate: parsedKey.predicate,
        value
    };
}
/**
 * Runs normalize advanced ransack conditions.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {ReturnType<typeof JSON.parse>} args.value - Advanced conditions collection.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
function normalizeAdvancedRansackConditions({ modelClass, value }) {
    /**
     * Conditions.
     * @type {RansackCondition[]} */
    const conditions = [];
    for (const entry of normalizeRansackCollection(value, "conditions")) {
        if (!isPlainObject(entry)) {
            throw ransackQueryError(`Ransack condition entries must be plain objects, got: ${typeof entry}`);
        }
        const predicateValue = entry.p;
        if (typeof predicateValue !== "string") {
            throw ransackQueryError("Ransack condition predicate must be a string");
        }
        if (!supportedPredicates.includes(predicateValue)) {
            throw ransackQueryError(`Unsupported ransack predicate in condition: ${predicateValue}`);
        }
        const predicate = /** @type {RansackPredicate} */ (predicateValue);
        const rawValue = advancedRansackConditionValue({ predicate, value: entry.v });
        const normalizedValue = normalizeRansackValue({ predicate, value: rawValue });
        if (normalizedValue === SKIP_RANSACK_CONDITION)
            continue;
        const attributes = resolveRansackAttributesFromAdvancedValue({ modelClass, value: entry.a });
        conditions.push({
            attributes,
            combinator: normalizeRansackCombinator(entry.m, attributes.length > 1 ? "or" : "and"),
            predicate,
            value: normalizedValue
        });
    }
    return conditions;
}
/**
 * Runs normalize advanced ransack groups.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {ReturnType<typeof JSON.parse>} args.value - Advanced groups collection.
 * @returns {RansackGroup[]} - Normalized groups.
 */
function normalizeAdvancedRansackGroups({ modelClass, value }) {
    /**
     * Groupings.
     * @type {RansackGroup[]} */
    const groupings = [];
    for (const entry of normalizeRansackCollection(value, "groupings")) {
        if (!isPlainObject(entry)) {
            throw ransackQueryError(`Ransack grouping entries must be plain objects, got: ${typeof entry}`);
        }
        groupings.push(normalizeRansackGroup(modelClass, entry));
    }
    return groupings;
}
/**
 * Runs normalize ransack combinator.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate combinator.
 * @param {RansackCombinator} defaultValue - Default combinator.
 * @returns {RansackCombinator} - Normalized combinator.
 */
function normalizeRansackCombinator(value, defaultValue) {
    if (value === undefined || value === null || value === "")
        return defaultValue;
    if (value === "and" || value === "or")
        return value;
    throw ransackQueryError(`Invalid ransack combinator: ${String(value)}`);
}
/**
 * Runs normalize ransack collection.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate collection.
 * @param {string} name - Collection name for errors.
 * @returns {Array<ReturnType<typeof JSON.parse>>} - Collection values in stable order.
 */
function normalizeRansackCollection(value, name) {
    if (value === undefined || value === null || value === "")
        return [];
    if (Array.isArray(value))
        return value;
    if (isPlainObject(value)) {
        return Object.keys(value)
            .sort((left, right) => {
            const leftNumber = Number(left);
            const rightNumber = Number(right);
            if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
                return leftNumber - rightNumber;
            }
            return left.localeCompare(right);
        })
            .map((key) => value[key]);
    }
    throw ransackQueryError(`Ransack ${name} must be an array or object, got: ${typeof value}`);
}
/**
 * Runs advanced ransack condition value.
 * @param {object} args - Options.
 * @param {RansackPredicate} args.predicate - Parsed predicate.
 * @param {ReturnType<typeof JSON.parse>} args.value - Advanced condition value.
 * @returns {ReturnType<typeof JSON.parse>} - Value passed to predicate normalization.
 */
function advancedRansackConditionValue({ predicate, value }) {
    if (predicate === "in" || predicate === "not_in")
        return value;
    if (Array.isArray(value)) {
        return value.find((entry) => entry !== undefined && entry !== null && entry !== "");
    }
    return value;
}
/**
 * Runs resolve ransack attributes from advanced value.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {ReturnType<typeof JSON.parse>} args.value - Advanced attribute value.
 * @returns {RansackAttribute[]} - Resolved attributes.
 */
function resolveRansackAttributesFromAdvancedValue({ modelClass, value }) {
    const values = normalizeAdvancedAttributeValues(value);
    /**
     * Attributes.
     * @type {RansackAttribute[]} */
    const attributes = [];
    for (const attributeValue of values) {
        attributes.push(...resolveRansackAttributes({ modelClass, value: attributeValue }));
    }
    if (attributes.length < 1) {
        throw ransackQueryError("Ransack condition must include at least one attribute");
    }
    return attributes;
}
/**
 * Runs normalize advanced attribute values.
 * @param {ReturnType<typeof JSON.parse>} value - Advanced attribute value.
 * @returns {string[]} - Attribute path strings.
 */
function normalizeAdvancedAttributeValues(value) {
    if (typeof value === "string")
        return [value];
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeAdvancedAttributeValue(entry));
    }
    if (isPlainObject(value)) {
        return normalizeRansackCollection(value, "attributes").map((entry) => normalizeAdvancedAttributeValue(entry));
    }
    throw ransackQueryError(`Ransack condition attributes must be strings, arrays, or objects, got: ${typeof value}`);
}
/**
 * Runs normalize advanced attribute value.
 * @param {ReturnType<typeof JSON.parse>} value - Advanced attribute entry.
 * @returns {string} - Attribute path string.
 */
function normalizeAdvancedAttributeValue(value) {
    if (typeof value === "string")
        return value;
    if (isPlainObject(value) && typeof value.name === "string") {
        return value.name;
    }
    throw ransackQueryError(`Ransack condition attribute entries must be strings or {name}, got: ${typeof value}`);
}
/**
 * Runs resolve ransack attributes.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {string} args.value - Attribute path value.
 * @returns {RansackAttribute[]} - Resolved attributes.
 */
function resolveRansackAttributes({ modelClass, value }) {
    return value.split("_or_").map((attributeValue) => {
        const resolvedPath = resolveRansackPath({ modelClass, value: attributeValue });
        const targetModelClass = modelClassAtPath({ modelClass, path: resolvedPath.path });
        const attributeName = resolveAttributeName({ modelClass: targetModelClass, value: resolvedPath.attributeValue });
        if (!attributeName) {
            throw ransackQueryError(`Unknown ransack attribute "${resolvedPath.attributeValue}" for ${targetModelClass.name}`);
        }
        return {
            attributeName,
            path: resolvedPath.path
        };
    });
}
/**
 * Runs model class at path.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Root model class.
 * @param {string[]} args.path - Relationship path.
 * @returns {RansackModelClass} - Target model class.
 */
function modelClassAtPath({ modelClass, path }) {
    let currentModelClass = modelClass;
    for (const relationshipName of path) {
        const relationship = relationshipEntries(currentModelClass)[relationshipName];
        if (!relationship) {
            throw ransackQueryError(`Unknown ransack relationship "${relationshipName}" for ${currentModelClass.name}`);
        }
        currentModelClass = relationship.targetModelClass;
    }
    return currentModelClass;
}
/**
 * Runs resolve ransack path.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Current model class.
 * @param {string} args.value - Remaining path value.
 * @returns {{attributeValue: string, path: string[]}} - Resolved relationship path and remaining attribute value.
 */
function resolveRansackPath({ modelClass, value }) {
    /**
     * Path.
     * @type {string[]} */
    const path = [];
    let currentModelClass = modelClass;
    let remainingValue = value;
    while (true) {
        if (resolveAttributeName({ modelClass: currentModelClass, value: remainingValue })) {
            break;
        }
        const match = findRelationshipPrefix({
            modelClass: currentModelClass,
            value: remainingValue
        });
        if (!match)
            break;
        path.push(match.relationshipName);
        currentModelClass = match.targetModelClass;
        remainingValue = match.remainingValue;
    }
    if (remainingValue.length < 1) {
        throw ransackQueryError(`Invalid ransack key path: ${value}`);
    }
    return {
        attributeValue: remainingValue,
        path
    };
}
/**
 * Runs find relationship prefix.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Current model class.
 * @param {string} args.value - Remaining value to match.
 * @returns {{relationshipName: string, remainingValue: string, targetModelClass: RansackModelClass} | null} - Matching relationship prefix.
 */
function findRelationshipPrefix({ modelClass, value }) {
    let bestMatch = null;
    for (const relationshipName of Object.keys(relationshipEntries(modelClass))) {
        const relationship = relationshipEntries(modelClass)[relationshipName];
        for (const candidate of relationshipCandidates(relationshipName)) {
            const remainingValue = stripRelationshipCandidate(value, candidate);
            if (remainingValue === null)
                continue;
            if (remainingValue.length < 1)
                continue;
            if (bestMatch && candidate.length <= bestMatch.candidateLength)
                continue;
            bestMatch = {
                candidateLength: candidate.length,
                relationshipName,
                remainingValue,
                targetModelClass: relationship.targetModelClass
            };
        }
    }
    if (!bestMatch)
        return null;
    return {
        relationshipName: bestMatch.relationshipName,
        remainingValue: bestMatch.remainingValue,
        targetModelClass: bestMatch.targetModelClass
    };
}
/**
 * Returns the portion of `value` after `candidate` when `candidate`
 * sits at a relationship-path boundary, or null when there's no
 * boundary match. Two boundary forms are accepted:
 * - snake: `<candidate>_` followed by the rest of the path (e.g.
 *   `task_project_id` against candidate `task` returns `project_id`).
 * - camel: `<candidate>` immediately followed by an uppercase letter,
 *   which marks a new word in camelCase (e.g. `taskProjectId` against
 *   candidate `task` returns `projectId` with the leading `P`
 *   lowercased so the remainder stays in caller-form for the next
 *   attribute / relationship match).
 * @param {string} value - Remaining ransack path.
 * @param {string} candidate - Relationship name candidate.
 * @returns {string | null} - Remainder after the candidate, or null.
 */
function stripRelationshipCandidate(value, candidate) {
    if (value.startsWith(`${candidate}_`)) {
        return value.slice(candidate.length + 1);
    }
    if (value.length <= candidate.length)
        return null;
    if (!value.startsWith(candidate))
        return null;
    const nextChar = value.charAt(candidate.length);
    if (nextChar < "A" || nextChar > "Z")
        return null;
    return nextChar.toLowerCase() + value.slice(candidate.length + 1);
}
/**
 * Runs relationship candidates.
 * @param {string} relationshipName - Relationship name.
 * @returns {string[]} - Candidate tokens for matching.
 */
function relationshipCandidates(relationshipName) {
    return uniqunize([relationshipName, inflection.underscore(relationshipName)]);
}
/**
 * Runs resolve attribute name.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {string} args.value - Attribute candidate.
 * @returns {string | undefined} - Resolved attribute name.
 */
function resolveAttributeName({ modelClass, value }) {
    for (const [attributeName, columnName] of Object.entries(attributeEntries(modelClass))) {
        if (matchesAttributeValue({ attributeName, columnName, value })) {
            return attributeName;
        }
    }
    return undefined;
}
/**
 * Runs relationship entries.
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function relationshipEntries(modelClass) {
    if (typeof /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).getRelationshipsMap === "function") {
        return backendRelationshipEntries(modelClass);
    }
    if (typeof /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).relationshipDefinitions === "function" &&
        typeof /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).relationshipModelClasses === "function") {
        return frontendRelationshipEntries(modelClass);
    }
    return {};
}
/**
 * Runs backend relationship entries.
 * @param {RansackModelClass} modelClass - Backend model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function backendRelationshipEntries(modelClass) {
    /**
     * Entries.
     * @type {Record<string, {targetModelClass: RansackModelClass}>} */
    const entries = {};
    const relationshipsMap = /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).getRelationshipsMap();
    for (const relationshipName of Object.keys(relationshipsMap)) {
        const relationship = relationshipsMap[relationshipName];
        if (typeof relationship.isPolymorphic === "function" && relationship.isPolymorphic())
            continue;
        const rawTargetModelClass = relationship.getTargetModelClass();
        if (!rawTargetModelClass)
            continue;
        const targetModelClass = /** @type {typeof import("../database/record/index.js").default} */ (modelClass)
            .bindRecordMetadataModelClass(rawTargetModelClass);
        entries[relationshipName] = { targetModelClass };
    }
    return entries;
}
/**
 * Runs frontend relationship entries.
 * @param {RansackModelClass} modelClass - Frontend model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function frontendRelationshipEntries(modelClass) {
    /**
     * Entries.
     * @type {Record<string, {targetModelClass: RansackModelClass}>} */
    const entries = {};
    const definitions = /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).relationshipDefinitions();
    const relationshipModelClasses = /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).relationshipModelClasses();
    for (const relationshipName of Object.keys(definitions)) {
        const targetModelClass = resolveFrontendModelClass(relationshipModelClasses[relationshipName]);
        if (!targetModelClass)
            continue;
        entries[relationshipName] = { targetModelClass };
    }
    return entries;
}
/**
 * Runs attribute entries.
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, string>} - Attribute-to-column entries keyed by attribute name.
 */
function attributeEntries(modelClass) {
    if (typeof /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).getAttributeNameToColumnNameMap === "function") {
        return /** @type {Record<string, string>} */ (( /** @type {ReturnType<typeof JSON.parse>} */(modelClass).getAttributeNameToColumnNameMap()));
    }
    const resourceConfig = typeof /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).resourceConfig === "function"
        ? /** @type {ReturnType<typeof JSON.parse>} */ (modelClass).resourceConfig()
        : {};
    const attributes = resourceConfig.attributes;
    /**
     * Entries.
     * @type {Record<string, string>} */
    const entries = {};
    if (Array.isArray(attributes)) {
        for (const attributeName of attributes) {
            if (typeof attributeName !== "string")
                continue;
            entries[attributeName] = attributeName;
        }
    }
    else if (isPlainObject(attributes)) {
        for (const attributeName of Object.keys(attributes)) {
            entries[attributeName] = attributeName;
        }
    }
    return entries;
}
/**
 * Runs matches attribute value.
 * @param {object} args - Options.
 * @param {string} args.attributeName - Attribute name.
 * @param {string} args.columnName - Column name.
 * @param {string} args.value - Candidate value.
 * @returns {boolean} - Whether the candidate resolves to the attribute.
 */
function matchesAttributeValue({ attributeName, columnName, value }) {
    return uniqunize([
        attributeName,
        columnName,
        inflection.underscore(attributeName),
        inflection.underscore(columnName)
    ]).includes(value);
}
/**
 * Runs parse ransack key.
 * @param {string} key - Ransack key.
 * @returns {{pathValue: string, predicate: RansackPredicate} | null} - Parsed key.
 */
function parseRansackKey(key) {
    for (const predicate of supportedPredicates) {
        const suffix = `_${predicate}`;
        if (!key.endsWith(suffix))
            continue;
        const pathValue = key.slice(0, key.length - suffix.length);
        if (pathValue.length < 1) {
            throw ransackQueryError(`Invalid ransack key: ${key}`);
        }
        return {
            pathValue,
            predicate: /** @type {RansackPredicate} */ (predicate)
        };
    }
    for (const predicate of supportedPredicates) {
        const camelSuffix = snakeToCamelSuffix(predicate);
        if (!key.endsWith(camelSuffix))
            continue;
        const pathValue = key.slice(0, key.length - camelSuffix.length);
        if (pathValue.length < 1) {
            throw ransackQueryError(`Invalid ransack key: ${key}`);
        }
        return {
            pathValue,
            predicate: /** @type {RansackPredicate} */ (predicate)
        };
    }
    return null;
}
/**
 * Runs snake to camel suffix.
 * @param {string} value - Snake-case predicate.
 * @returns {string} - CamelCase predicate suffix used in ransack keys.
 */
function snakeToCamelSuffix(value) {
    const segments = value.split("_");
    return segments.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join("");
}
/**
 * Runs normalize ransack value.
 * @param {object} args - Options.
 * @param {RansackPredicate} args.predicate - Parsed predicate.
 * @param {ReturnType<typeof JSON.parse>} args.value - Raw value.
 * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
 */
function normalizeRansackValue({ predicate, value }) {
    if (predicate === "null") {
        return normalizeRansackNullValue(value);
    }
    if (predicate === "in" || predicate === "not_in") {
        return normalizeRansackListValue(value);
    }
    if (ransackValueIsBlank(value))
        return SKIP_RANSACK_CONDITION;
    return value;
}
/**
 * Runs normalize ransack null value.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate null predicate value.
 * @returns {boolean | typeof SKIP_RANSACK_CONDITION} - Normalized value.
 */
function normalizeRansackNullValue(value) {
    const booleanValue = normalizeRansackBoolean(value);
    return booleanValue === null ? SKIP_RANSACK_CONDITION : booleanValue;
}
/**
 * Runs normalize ransack list value.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate list predicate value.
 * @returns {Array<ReturnType<typeof JSON.parse>> | typeof SKIP_RANSACK_CONDITION} - Normalized value.
 */
function normalizeRansackListValue(value) {
    const normalizedArray = normalizeRansackArray(value);
    return normalizedArray.length < 1 ? SKIP_RANSACK_CONDITION : normalizedArray;
}
/**
 * Ransack true values.
 * @type {Set<ReturnType<typeof JSON.parse>>} */
const ransackTrueValues = new Set([true, 1, "1", "true"]);
/**
 * Ransack false values.
 * @type {Set<ReturnType<typeof JSON.parse>>} */
const ransackFalseValues = new Set([false, 0, "0", "false"]);
/**
 * Runs normalize ransack boolean.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate boolean.
 * @returns {boolean | null} - Normalized boolean or null when blank.
 */
function normalizeRansackBoolean(value) {
    if (ransackTrueValues.has(value))
        return true;
    if (ransackFalseValues.has(value))
        return false;
    if (ransackValueIsBlank(value))
        return null;
    throw ransackQueryError(`Invalid ransack boolean value: ${String(value)}`);
}
/**
 * Runs ransack value is blank.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value should be ignored as blank.
 */
function ransackValueIsBlank(value) {
    return value === undefined || value === null || value === "";
}
/**
 * Runs normalize ransack array.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate array-ish value.
 * @returns {Array<ReturnType<typeof JSON.parse>>} - Normalized array values.
 */
function normalizeRansackArray(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => entry !== undefined && entry !== null && entry !== "");
    }
    if (typeof value === "string") {
        return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    }
    if (value === undefined || value === null || value === "")
        return [];
    return [value];
}
/**
 * Parses a ransack `s` sort string against model attributes.
 * @param {RansackModelClass} modelClass - Model class for attribute lookup.
 * @param {string} sortString - Ransack sort string (e.g., "name asc" or "name asc, createdAt desc").
 * @returns {RansackSort[]} - Parsed sort definitions.
 */
export function parseRansackSort(modelClass, sortString) {
    const segments = sortString.split(",").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
    /**
     * Sorts.
     * @type {RansackSort[]} */
    const sorts = [];
    for (const segment of segments) {
        const parts = segment.split(/\s+/);
        const columnCandidate = parts[0];
        const directionCandidate = parts.length > 1 ? parts[1].toLowerCase() : "asc";
        if (directionCandidate !== "asc" && directionCandidate !== "desc") {
            throw ransackQueryError(`Invalid ransack sort direction "${directionCandidate}" in: ${segment}`);
        }
        const resolvedAttribute = resolveAttributeName({ modelClass, value: columnCandidate });
        if (!resolvedAttribute) {
            throw ransackQueryError(`Unknown ransack sort attribute "${columnCandidate}" for ${modelClass.name}`);
        }
        sorts.push({ attribute: resolvedAttribute, direction: directionCandidate });
    }
    return sorts;
}
/**
 * Runs uniqunize.
 * @param {string[]} values - Input values.
 * @returns {string[]} - Unique values in original order.
 */
function uniqunize(values) {
    return Array.from(new Set(values));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmFuc2Fjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy91dGlscy9yYW5zYWNrLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDN0MsT0FBTyxFQUFDLHlCQUF5QixFQUFDLE1BQU0sc0NBQXNDLENBQUE7QUFFOUU7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSCwyREFBMkQ7QUFDM0QsTUFBTSxPQUFPLGlCQUFrQixTQUFRLEtBQUs7SUFDMUM7OztPQUdHO0lBQ0gsWUFBWSxPQUFPO1FBQ2pCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUVkLElBQUksQ0FBQyxJQUFJLEdBQUcsbUJBQW1CLENBQUE7SUFDakMsQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENBQUMsT0FBTztJQUNoQyxPQUFPLElBQUksaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUE7QUFDdkMsQ0FBQztBQUVELE1BQU0sbUJBQW1CLEdBQUc7SUFDMUIsUUFBUTtJQUNSLFFBQVE7SUFDUixNQUFNO0lBQ04sTUFBTTtJQUNOLE9BQU87SUFDUCxNQUFNO0lBQ04sTUFBTTtJQUNOLEtBQUs7SUFDTCxJQUFJO0lBQ0osSUFBSTtJQUNKLElBQUk7SUFDSixJQUFJO0NBQ0wsQ0FBQTtBQUVEOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxNQUFNO0lBQ3ZELE9BQU8scUJBQXFCLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLFVBQVUsQ0FBQTtBQUM3RCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxNQUFNLFVB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QUFPLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ2xDLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUNoQyxNQUFNLGtCQUFrQixHQUFHLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtRQUU1RSxJQUFJLGtCQUFrQixLQUFLLEtBQUssSUFBSSxrQkFBa0IsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUNsRSxNQUFNLGlCQUFpQixDQUFDLG1DQUFtQyxrQkFBa0IsU0FBUyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQ2xHLENBQUM7UUFFRCxNQUFNLGlCQUFpQixHQUFHLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1FBRXBGLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0saUJBQWlCLENBQUMsbUNBQW1DLGVBQWUsU0FBUyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUN2RyxDQUFDO1FBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxTQUFTLEVBQUUsa0JBQWtCLEVBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxTQUFTLENBQUMsTUFBTTtJQUN2QixPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtBQUNwQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCB7cmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzc30gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy9tb2RlbC1yZWdpc3RyeS5qc1wiXG5cbi8qKlxuICogUmFuc2Fja1ByZWRpY2F0ZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY29udFwiIHwgXCJlbmRcIiB8IFwiZXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJpblwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcIm5vdF9lcVwiIHwgXCJub3RfaW5cIiB8IFwibnVsbFwiIHwgXCJzdGFydFwifSBSYW5zYWNrUHJlZGljYXRlXG4gKi9cbi8qKlxuICogUmFuc2Fja0NvbWJpbmF0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtcImFuZFwiIHwgXCJvclwifSBSYW5zYWNrQ29tYmluYXRvclxuICovXG4vKipcbiAqIFJhbnNhY2tNb2RlbENsYXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbENsYXNzfSBSYW5zYWNrTW9kZWxDbGFzc1xuICovXG4vKipcbiAqIFJhbnNhY2tBdHRyaWJ1dGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJhbnNhY2tBdHRyaWJ1dGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gUmVzb2x2ZWQgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVzb2x2ZWQgcmVsYXRpb25zaGlwIHBhdGguXG4gKi9cbi8qKlxuICogUmFuc2Fja0NvbmRpdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmFuc2Fja0NvbmRpdGlvblxuICogQHByb3BlcnR5IHtSYW5zYWNrQXR0cmlidXRlW119IGF0dHJpYnV0ZXMgLSBSZXNvbHZlZCBhdHRyaWJ1dGVzIHRvIHRlc3QuXG4gKiBAcHJvcGVydHkge1JhbnNhY2tDb21iaW5hdG9yfSBjb21iaW5hdG9yIC0gSG93IG11bHRpcGxlIGF0dHJpYnV0ZXMgYXJlIGNvbWJpbmVkLlxuICogQHByb3BlcnR5IHtSYW5zYWNrUHJlZGljYXRlfSBwcmVkaWNhdGUgLSBQYXJzZWQgUmFuc2FjayBwcmVkaWNhdGUuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbi8qKlxuICogUmFuc2Fja0dyb3VwIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSYW5zYWNrR3JvdXBcbiAqIEBwcm9wZXJ0eSB7UmFuc2Fja0NvbWJpbmF0b3J9IGNvbWJpbmF0b3IgLSBIb3cgZW50cmllcyBpbnNpZGUgdGhpcyBncm91cCBhcmUgY29tYmluZWQuXG4gKiBAcHJvcGVydHkge1JhbnNhY2tDb25kaXRpb25bXX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaW4gdGhpcyBncm91cC5cbiAqIEBwcm9wZXJ0eSB7UmFuc2Fja0dyb3VwW119IGdyb3VwaW5ncyAtIE5lc3RlZCBncm91cHMuXG4gKi9cbi8qKlxuICogUmFuc2Fja1NvcnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJhbnNhY2tTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXR0cmlidXRlIC0gUmVzb2x2ZWQgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiYXNjXCIgfCBcImRlc2NcIn0gZGlyZWN0aW9uIC0gU29ydCBkaXJlY3Rpb24uXG4gKi9cbi8qKiBFcnJvciByYWlzZWQgd2hlbiBhIFJhbnNhY2sgZGVzY3JpcHRvciBpcyBtYWxmb3JtZWQuICovXG5leHBvcnQgY2xhc3MgUmFuc2Fja1F1ZXJ5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgUmFuc2FjayBxdWVyeSBlcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG5cbiAgICB0aGlzLm5hbWUgPSBcIlJhbnNhY2tRdWVyeUVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIFJhbnNhY2sgcXVlcnkgZXJyb3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7UmFuc2Fja1F1ZXJ5RXJyb3J9IC0gUmFuc2FjayBxdWVyeSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmFuc2Fja1F1ZXJ5RXJyb3IobWVzc2FnZSkge1xuICByZXR1cm4gbmV3IFJhbnNhY2tRdWVyeUVycm9yKG1lc3NhZ2UpXG59XG5cbmNvbnN0IHN1cHBvcnRlZFByZWRpY2F0ZXMgPSBbXG4gIFwibm90X2luXCIsXG4gIFwibm90X2VxXCIsXG4gIFwiZ3RlcVwiLFxuICBcImx0ZXFcIixcbiAgXCJzdGFydFwiLFxuICBcImNvbnRcIixcbiAgXCJudWxsXCIsXG4gIFwiZW5kXCIsXG4gIFwiZXFcIixcbiAgXCJndFwiLFxuICBcImx0XCIsXG4gIFwiaW5cIlxuXVxuXG4vKipcbiAqIFJ1bnMgdGhlIG5vcm1hbGl6ZVJhbnNhY2tQYXJhbXMgaGVscGVyLlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guXG4gKiBAcmV0dXJucyB7UmFuc2Fja0NvbmRpdGlvbltdfSAtIE5vcm1hbGl6ZWQgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVJhbnNhY2tQYXJhbXMobW9kZWxDbGFzcywgcGFyYW1zKSB7XG4gIHJldHVybiBub3JtYWxpemVSYW5zYWNrR3JvdXAobW9kZWxDbGFzcywgcGFyYW1zKS5jb25kaXRpb25zXG59XG5cbi8qKlxuICogUnVucyB0aGUgbm9ybWFsaXplUmFuc2Fja0dyb3VwIGhlbHBlci5cbiAqIEBwYXJhbSB7UmFuc2Fja01vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICogQHJldHVybnMge1JhbnNhY2tHcm91cH0gLSBOb3JtYWxpemVkIGdyb3VwLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUmFuc2Fja0dyb3VwKG1vZGVsQ2xhc3MsIHBhcmFtcykge1xuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyYW1zKSkge1xuICAgIHRocm93IHJhbnNhY2tRdWVyeUVycm9yKGByYW5zYWNrIHBhcmFtcyBtdXN0IGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7dHlwZW9mIHBhcmFtc31gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSYW5zYWNrR3JvdXB9ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7XG4gICAgY29tYmluYXRvcjogbm9ybWFsaXplUmFuc2Fja0NvbWJpbmF0b3IocGFyYW1zLm0sIFwiYW5kXCIpLFxuICAgIGNvbmRpdGlvbnM6IFtdLFxuICAgIGdyb3VwaW5nczogW11cbiAgfVxuXG4gIGZvciAoY29uc3QgW2tleSwgcmF3VmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcmFtcykpIHtcbiAgICBpZiAoa2V5ID09PSBcIm1cIikge1xuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoa2V5ID09PSBcImNcIikge1xuICAgICAgbm9ybWFsaXplZC5jb25kaXRpb25zLnB1c2goLi4ubm9ybWFsaXplQWR2YW5jZWRSYW5zYWNrQ29uZGl0aW9ucyh7bW9kZWxDbGFzcywgdmFsdWU6IHJhd1ZhbHVlfSkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChrZXkgPT09IFwiZ1wiKSB7XG4gICAgICBub3JtYWxpemVkLmdyb3VwaW5ncy5wdXNoKC4uLm5vcm1hbGl6ZUFkdmFuY2VkUmFuc2Fja0dyb3Vwcyh7bW9kZWxDbGFzcywgdmFsdWU6IHJhd1ZhbHVlfSkpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmRpdGlvbiA9IG5vcm1hbGl6ZVNpbXBsZVJhbnNhY2tDb25kaXRpb24oe2tleSwgbW9kZWxDbGFzcywgcmF3VmFsdWV9KVxuICAgIGlmIChjb25kaXRpb24pIG5vcm1hbGl6ZWQuY29uZGl0aW9ucy5wdXNoKGNvbmRpdGlvbilcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbmNvbnN0IFNLSVBfUkFOU0FDS19DT05ESVRJT04gPSBTeW1ib2woXCJza2lwLXJhbnNhY2stY29uZGl0aW9uXCIpXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgc2ltcGxlIHJhbnNhY2sgY29uZGl0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mua2V5IC0gU2ltcGxlIFJhbnNhY2sga2V5LlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJhd1ZhbHVlIC0gUmF3IGNvbmRpdGlvbiB2YWx1ZS5cbiAqIEByZXR1cm5zIHtSYW5zYWNrQ29uZGl0aW9uIHwgbnVsbH0gLSBOb3JtYWxpemVkIGNvbmRpdGlvbiwgb3IgbnVsbCB3aGVuIHNraXBwZWQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNpbXBsZVJhbnNhY2tDb25kaXRpb24oe2tleSwgbW9kZWxDbGFzcywgcmF3VmFsdWV9KSB7XG4gIGNvbnN0IHBhcnNlZEtleSA9IHBhcnNlUmFuc2Fja0tleShrZXkpXG5cbiAgaWYgKCFwYXJzZWRLZXkpIHtcbiAgICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihgVW5zdXBwb3J0ZWQgcmFuc2FjayBwcmVkaWNhdGUgaW4ga2V5OiAke2tleX1gKVxuICB9XG5cbiAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVSYW5zYWNrVmFsdWUoe1xuICAgIHByZWRpY2F0ZTogcGFyc2VkS2V5LnByZWRpY2F0ZSxcbiAgICB2YWx1ZTogcmF3VmFsdWVcbiAgfSlcblxuICBpZiAodmFsdWUgPT09IFNLSVBfUkFOU0FDS19DT05ESVRJT04pIHJldHVybiBudWxsXG5cbiAgY29uc3QgYXR0cmlidXRlcyA9IHJlc29sdmVSYW5zYWNrQXR0cmlidXRlcyh7bW9kZWxDbGFzcywgdmFsdWU6IHBhcnNlZEtleS5wYXRoVmFsdWV9KVxuXG4gIHJldHVybiB7XG4gICAgYXR0cmlidXRlcyxcbiAgICBjb21iaW5hdG9yOiBhdHRyaWJ1dGVzLmxlbmd0aCA+IDEgPyBcIm9yXCIgOiBcImFuZFwiLFxuICAgIHByZWRpY2F0ZTogcGFyc2VkS2V5LnByZWRpY2F0ZSxcbiAgICB2YWx1ZVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgYWR2YW5jZWQgcmFuc2FjayBjb25kaXRpb25zLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gQWR2YW5jZWQgY29uZGl0aW9ucyBjb2xsZWN0aW9uLlxuICogQHJldHVybnMge1JhbnNhY2tDb25kaXRpb25bXX0gLSBOb3JtYWxpemVkIGNvbmRpdGlvbnMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFkdmFuY2VkUmFuc2Fja0NvbmRpdGlvbnMoe21vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICAvKipcbiAgICogQ29uZGl0aW9ucy5cbiAgICogQHR5cGUge1JhbnNhY2tDb25kaXRpb25bXX0gKi9cbiAgY29uc3QgY29uZGl0aW9ucyA9IFtdXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVSYW5zYWNrQ29sbGVjdGlvbih2YWx1ZSwgXCJjb25kaXRpb25zXCIpKSB7XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkge1xuICAgICAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYFJhbnNhY2sgY29uZGl0aW9uIGVudHJpZXMgbXVzdCBiZSBwbGFpbiBvYmplY3RzLCBnb3Q6ICR7dHlwZW9mIGVudHJ5fWApXG4gICAgfVxuXG4gICAgY29uc3QgcHJlZGljYXRlVmFsdWUgPSBlbnRyeS5wXG5cbiAgICBpZiAodHlwZW9mIHByZWRpY2F0ZVZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihcIlJhbnNhY2sgY29uZGl0aW9uIHByZWRpY2F0ZSBtdXN0IGJlIGEgc3RyaW5nXCIpXG4gICAgfVxuXG4gICAgaWYgKCFzdXBwb3J0ZWRQcmVkaWNhdGVzLmluY2x1ZGVzKHByZWRpY2F0ZVZhbHVlKSkge1xuICAgICAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYFVuc3VwcG9ydGVkIHJhbnNhY2sgcHJlZGljYXRlIGluIGNvbmRpdGlvbjogJHtwcmVkaWNhdGVWYWx1ZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHByZWRpY2F0ZSA9IC8qKiBAdHlwZSB7UmFuc2Fja1ByZWRpY2F0ZX0gKi8gKHByZWRpY2F0ZVZhbHVlKVxuICAgIGNvbnN0IHJhd1ZhbHVlID0gYWR2YW5jZWRSYW5zYWNrQ29uZGl0aW9uVmFsdWUoe3ByZWRpY2F0ZSwgdmFsdWU6IGVudHJ5LnZ9KVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IG5vcm1hbGl6ZVJhbnNhY2tWYWx1ZSh7cHJlZGljYXRlLCB2YWx1ZTogcmF3VmFsdWV9KVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gU0tJUF9SQU5TQUNLX0NPTkRJVElPTikgY29udGludWVcblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSByZXNvbHZlUmFuc2Fja0F0dHJpYnV0ZXNGcm9tQWR2YW5jZWRWYWx1ZSh7bW9kZWxDbGFzcywgdmFsdWU6IGVudHJ5LmF9KVxuXG4gICAgY29uZGl0aW9ucy5wdXNoKHtcbiAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICBjb21iaW5hdG9yOiBub3JtYWxpemVSYW5zYWNrQ29tYmluYXRvcihlbnRyeS5tLCBhdHRyaWJ1dGVzLmxlbmd0aCA+IDEgPyBcIm9yXCIgOiBcImFuZFwiKSxcbiAgICAgIHByZWRpY2F0ZSxcbiAgICAgIHZhbHVlOiBub3JtYWxpemVkVmFsdWVcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIGNvbmRpdGlvbnNcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBhZHZhbmNlZCByYW5zYWNrIGdyb3Vwcy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmFuc2Fja01vZGVsQ2xhc3N9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIEFkdmFuY2VkIGdyb3VwcyBjb2xsZWN0aW9uLlxuICogQHJldHVybnMge1JhbnNhY2tHcm91cFtdfSAtIE5vcm1hbGl6ZWQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVBZHZhbmNlZFJhbnNhY2tHcm91cHMoe21vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICAvKipcbiAgICogR3JvdXBpbmdzLlxuICAgKiBAdHlwZSB7UmFuc2Fja0dyb3VwW119ICovXG4gIGNvbnN0IGdyb3VwaW5ncyA9IFtdXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVSYW5zYWNrQ29sbGVjdGlvbih2YWx1ZSwgXCJncm91cGluZ3NcIikpIHtcbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB7XG4gICAgICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihgUmFuc2FjayBncm91cGluZyBlbnRyaWVzIG11c3QgYmUgcGxhaW4gb2JqZWN0cywgZ290OiAke3R5cGVvZiBlbnRyeX1gKVxuICAgIH1cblxuICAgIGdyb3VwaW5ncy5wdXNoKG5vcm1hbGl6ZVJhbnNhY2tHcm91cChtb2RlbENsYXNzLCBlbnRyeSkpXG4gIH1cblxuICByZXR1cm4gZ3JvdXBpbmdzXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmFuc2FjayBjb21iaW5hdG9yLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgY29tYmluYXRvci5cbiAqIEBwYXJhbSB7UmFuc2Fja0NvbWJpbmF0b3J9IGRlZmF1bHRWYWx1ZSAtIERlZmF1bHQgY29tYmluYXRvci5cbiAqIEByZXR1cm5zIHtSYW5zYWNrQ29tYmluYXRvcn0gLSBOb3JtYWxpemVkIGNvbWJpbmF0b3IuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJhbnNhY2tDb21iaW5hdG9yKHZhbHVlLCBkZWZhdWx0VmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBkZWZhdWx0VmFsdWVcbiAgaWYgKHZhbHVlID09PSBcImFuZFwiIHx8IHZhbHVlID09PSBcIm9yXCIpIHJldHVybiB2YWx1ZVxuXG4gIHRocm93IHJhbnNhY2tRdWVyeUVycm9yKGBJbnZhbGlkIHJhbnNhY2sgY29tYmluYXRvcjogJHtTdHJpbmcodmFsdWUpfWApXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmFuc2FjayBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgY29sbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQ29sbGVjdGlvbiBuYW1lIGZvciBlcnJvcnMuXG4gKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbGxlY3Rpb24gdmFsdWVzIGluIHN0YWJsZSBvcmRlci5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmFuc2Fja0NvbGxlY3Rpb24odmFsdWUsIG5hbWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBbXVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KHZhbHVlKSkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh2YWx1ZSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4ge1xuICAgICAgICBjb25zdCBsZWZ0TnVtYmVyID0gTnVtYmVyKGxlZnQpXG4gICAgICAgIGNvbnN0IHJpZ2h0TnVtYmVyID0gTnVtYmVyKHJpZ2h0KVxuXG4gICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobGVmdE51bWJlcikgJiYgTnVtYmVyLmlzRmluaXRlKHJpZ2h0TnVtYmVyKSkge1xuICAgICAgICAgIHJldHVybiBsZWZ0TnVtYmVyIC0gcmlnaHROdW1iZXJcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBsZWZ0LmxvY2FsZUNvbXBhcmUocmlnaHQpXG4gICAgICB9KVxuICAgICAgLm1hcCgoa2V5KSA9PiB2YWx1ZVtrZXldKVxuICB9XG5cbiAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYFJhbnNhY2sgJHtuYW1lfSBtdXN0IGJlIGFuIGFycmF5IG9yIG9iamVjdCwgZ290OiAke3R5cGVvZiB2YWx1ZX1gKVxufVxuXG4vKipcbiAqIFJ1bnMgYWR2YW5jZWQgcmFuc2FjayBjb25kaXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1JhbnNhY2tQcmVkaWNhdGV9IGFyZ3MucHJlZGljYXRlIC0gUGFyc2VkIHByZWRpY2F0ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBBZHZhbmNlZCBjb25kaXRpb24gdmFsdWUuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVmFsdWUgcGFzc2VkIHRvIHByZWRpY2F0ZSBub3JtYWxpemF0aW9uLlxuICovXG5mdW5jdGlvbiBhZHZhbmNlZFJhbnNhY2tDb25kaXRpb25WYWx1ZSh7cHJlZGljYXRlLCB2YWx1ZX0pIHtcbiAgaWYgKHByZWRpY2F0ZSA9PT0gXCJpblwiIHx8IHByZWRpY2F0ZSA9PT0gXCJub3RfaW5cIikgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkICYmIGVudHJ5ICE9PSBudWxsICYmIGVudHJ5ICE9PSBcIlwiKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIHJhbnNhY2sgYXR0cmlidXRlcyBmcm9tIGFkdmFuY2VkIHZhbHVlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gQWR2YW5jZWQgYXR0cmlidXRlIHZhbHVlLlxuICogQHJldHVybnMge1JhbnNhY2tBdHRyaWJ1dGVbXX0gLSBSZXNvbHZlZCBhdHRyaWJ1dGVzLlxuICovXG5mdW5jdGlvbiByZXNvbHZlUmFuc2Fja0F0dHJpYnV0ZXNGcm9tQWR2YW5jZWRWYWx1ZSh7bW9kZWxDbGFzcywgdmFsdWV9KSB7XG4gIGNvbnN0IHZhbHVlcyA9IG5vcm1hbGl6ZUFkdmFuY2VkQXR0cmlidXRlVmFsdWVzKHZhbHVlKVxuICAvKipcbiAgICogQXR0cmlidXRlcy5cbiAgICogQHR5cGUge1JhbnNhY2tBdHRyaWJ1dGVbXX0gKi9cbiAgY29uc3QgYXR0cmlidXRlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVWYWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICBhdHRyaWJ1dGVzLnB1c2goLi4ucmVzb2x2ZVJhbnNhY2tBdHRyaWJ1dGVzKHttb2RlbENsYXNzLCB2YWx1ZTogYXR0cmlidXRlVmFsdWV9KSlcbiAgfVxuXG4gIGlmIChhdHRyaWJ1dGVzLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihcIlJhbnNhY2sgY29uZGl0aW9uIG11c3QgaW5jbHVkZSBhdCBsZWFzdCBvbmUgYXR0cmlidXRlXCIpXG4gIH1cblxuICByZXR1cm4gYXR0cmlidXRlc1xufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGFkdmFuY2VkIGF0dHJpYnV0ZSB2YWx1ZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEFkdmFuY2VkIGF0dHJpYnV0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBBdHRyaWJ1dGUgcGF0aCBzdHJpbmdzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVBZHZhbmNlZEF0dHJpYnV0ZVZhbHVlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSByZXR1cm4gW3ZhbHVlXVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBub3JtYWxpemVBZHZhbmNlZEF0dHJpYnV0ZVZhbHVlKGVudHJ5KSlcbiAgfVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KHZhbHVlKSkge1xuICAgIHJldHVybiBub3JtYWxpemVSYW5zYWNrQ29sbGVjdGlvbih2YWx1ZSwgXCJhdHRyaWJ1dGVzXCIpLm1hcCgoZW50cnkpID0+IG5vcm1hbGl6ZUFkdmFuY2VkQXR0cmlidXRlVmFsdWUoZW50cnkpKVxuICB9XG5cbiAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYFJhbnNhY2sgY29uZGl0aW9uIGF0dHJpYnV0ZXMgbXVzdCBiZSBzdHJpbmdzLCBhcnJheXMsIG9yIG9iamVjdHMsIGdvdDogJHt0eXBlb2YgdmFsdWV9YClcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBhZHZhbmNlZCBhdHRyaWJ1dGUgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEFkdmFuY2VkIGF0dHJpYnV0ZSBlbnRyeS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0cmlidXRlIHBhdGggc3RyaW5nLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVBZHZhbmNlZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZVxuXG4gIGlmIChpc1BsYWluT2JqZWN0KHZhbHVlKSAmJiB0eXBlb2YgdmFsdWUubmFtZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB2YWx1ZS5uYW1lXG4gIH1cblxuICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihgUmFuc2FjayBjb25kaXRpb24gYXR0cmlidXRlIGVudHJpZXMgbXVzdCBiZSBzdHJpbmdzIG9yIHtuYW1lfSwgZ290OiAke3R5cGVvZiB2YWx1ZX1gKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSByYW5zYWNrIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZhbHVlIC0gQXR0cmlidXRlIHBhdGggdmFsdWUuXG4gKiBAcmV0dXJucyB7UmFuc2Fja0F0dHJpYnV0ZVtdfSAtIFJlc29sdmVkIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVSYW5zYWNrQXR0cmlidXRlcyh7bW9kZWxDbGFzcywgdmFsdWV9KSB7XG4gIHJldHVybiB2YWx1ZS5zcGxpdChcIl9vcl9cIikubWFwKChhdHRyaWJ1dGVWYWx1ZSkgPT4ge1xuICAgIGNvbnN0IHJlc29sdmVkUGF0aCA9IHJlc29sdmVSYW5zYWNrUGF0aCh7bW9kZWxDbGFzcywgdmFsdWU6IGF0dHJpYnV0ZVZhbHVlfSlcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzc0F0UGF0aCh7bW9kZWxDbGFzcywgcGF0aDogcmVzb2x2ZWRQYXRoLnBhdGh9KVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSByZXNvbHZlQXR0cmlidXRlTmFtZSh7bW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcywgdmFsdWU6IHJlc29sdmVkUGF0aC5hdHRyaWJ1dGVWYWx1ZX0pXG5cbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIHRocm93IHJhbnNhY2tRdWVyeUVycm9yKGBVbmtub3duIHJhbnNhY2sgYXR0cmlidXRlIFwiJHtyZXNvbHZlZFBhdGguYXR0cmlidXRlVmFsdWV9XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICBwYXRoOiByZXNvbHZlZFBhdGgucGF0aFxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIG1vZGVsIGNsYXNzIGF0IHBhdGguXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBhcmdzLm1vZGVsQ2xhc3MgLSBSb290IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7UmFuc2Fja01vZGVsQ2xhc3N9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBtb2RlbENsYXNzQXRQYXRoKHttb2RlbENsYXNzLCBwYXRofSkge1xuICBsZXQgY3VycmVudE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG5cbiAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHBhdGgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXBFbnRyaWVzKGN1cnJlbnRNb2RlbENsYXNzKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IHJhbnNhY2tRdWVyeUVycm9yKGBVbmtub3duIHJhbnNhY2sgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke2N1cnJlbnRNb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBjdXJyZW50TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC50YXJnZXRNb2RlbENsYXNzXG4gIH1cblxuICByZXR1cm4gY3VycmVudE1vZGVsQ2xhc3Ncbn1cblxuLyoqXG4gKiBSdW5zIHJlc29sdmUgcmFuc2FjayBwYXRoLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gYXJncy5tb2RlbENsYXNzIC0gQ3VycmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZhbHVlIC0gUmVtYWluaW5nIHBhdGggdmFsdWUuXG4gKiBAcmV0dXJucyB7e2F0dHJpYnV0ZVZhbHVlOiBzdHJpbmcsIHBhdGg6IHN0cmluZ1tdfX0gLSBSZXNvbHZlZCByZWxhdGlvbnNoaXAgcGF0aCBhbmQgcmVtYWluaW5nIGF0dHJpYnV0ZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVJhbnNhY2tQYXRoKHttb2RlbENsYXNzLCB2YWx1ZX0pIHtcbiAgLyoqXG4gICAqIFBhdGguXG4gICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgcGF0aCA9IFtdXG4gIGxldCBjdXJyZW50TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcbiAgbGV0IHJlbWFpbmluZ1ZhbHVlID0gdmFsdWVcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChyZXNvbHZlQXR0cmlidXRlTmFtZSh7bW9kZWxDbGFzczogY3VycmVudE1vZGVsQ2xhc3MsIHZhbHVlOiByZW1haW5pbmdWYWx1ZX0pKSB7XG4gICAgICBicmVha1xuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoID0gZmluZFJlbGF0aW9uc2hpcFByZWZpeCh7XG4gICAgICBtb2RlbENsYXNzOiBjdXJyZW50TW9kZWxDbGFzcyxcbiAgICAgIHZhbHVlOiByZW1haW5pbmdWYWx1ZVxuICAgIH0pXG5cbiAgICBpZiAoIW1hdGNoKSBicmVha1xuXG4gICAgcGF0aC5wdXNoKG1hdGNoLnJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY3VycmVudE1vZGVsQ2xhc3MgPSBtYXRjaC50YXJnZXRNb2RlbENsYXNzXG4gICAgcmVtYWluaW5nVmFsdWUgPSBtYXRjaC5yZW1haW5pbmdWYWx1ZVxuICB9XG5cbiAgaWYgKHJlbWFpbmluZ1ZhbHVlLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihgSW52YWxpZCByYW5zYWNrIGtleSBwYXRoOiAke3ZhbHVlfWApXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGF0dHJpYnV0ZVZhbHVlOiByZW1haW5pbmdWYWx1ZSxcbiAgICBwYXRoXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZpbmQgcmVsYXRpb25zaGlwIHByZWZpeC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmFuc2Fja01vZGVsQ2xhc3N9IGFyZ3MubW9kZWxDbGFzcyAtIEN1cnJlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52YWx1ZSAtIFJlbWFpbmluZyB2YWx1ZSB0byBtYXRjaC5cbiAqIEByZXR1cm5zIHt7cmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCByZW1haW5pbmdWYWx1ZTogc3RyaW5nLCB0YXJnZXRNb2RlbENsYXNzOiBSYW5zYWNrTW9kZWxDbGFzc30gfCBudWxsfSAtIE1hdGNoaW5nIHJlbGF0aW9uc2hpcCBwcmVmaXguXG4gKi9cbmZ1bmN0aW9uIGZpbmRSZWxhdGlvbnNoaXBQcmVmaXgoe21vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICBsZXQgYmVzdE1hdGNoID0gbnVsbFxuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBFbnRyaWVzKG1vZGVsQ2xhc3MpKSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcEVudHJpZXMobW9kZWxDbGFzcylbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIHJlbGF0aW9uc2hpcENhbmRpZGF0ZXMocmVsYXRpb25zaGlwTmFtZSkpIHtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1ZhbHVlID0gc3RyaXBSZWxhdGlvbnNoaXBDYW5kaWRhdGUodmFsdWUsIGNhbmRpZGF0ZSlcblxuICAgICAgaWYgKHJlbWFpbmluZ1ZhbHVlID09PSBudWxsKSBjb250aW51ZVxuICAgICAgaWYgKHJlbWFpbmluZ1ZhbHVlLmxlbmd0aCA8IDEpIGNvbnRpbnVlXG4gICAgICBpZiAoYmVzdE1hdGNoICYmIGNhbmRpZGF0ZS5sZW5ndGggPD0gYmVzdE1hdGNoLmNhbmRpZGF0ZUxlbmd0aCkgY29udGludWVcblxuICAgICAgYmVzdE1hdGNoID0ge1xuICAgICAgICBjYW5kaWRhdGVMZW5ndGg6IGNhbmRpZGF0ZS5sZW5ndGgsXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgIHJlbWFpbmluZ1ZhbHVlLFxuICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiByZWxhdGlvbnNoaXAudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICghYmVzdE1hdGNoKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiB7XG4gICAgcmVsYXRpb25zaGlwTmFtZTogYmVzdE1hdGNoLnJlbGF0aW9uc2hpcE5hbWUsXG4gICAgcmVtYWluaW5nVmFsdWU6IGJlc3RNYXRjaC5yZW1haW5pbmdWYWx1ZSxcbiAgICB0YXJnZXRNb2RlbENsYXNzOiBiZXN0TWF0Y2gudGFyZ2V0TW9kZWxDbGFzc1xuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgcG9ydGlvbiBvZiBgdmFsdWVgIGFmdGVyIGBjYW5kaWRhdGVgIHdoZW4gYGNhbmRpZGF0ZWBcbiAqIHNpdHMgYXQgYSByZWxhdGlvbnNoaXAtcGF0aCBib3VuZGFyeSwgb3IgbnVsbCB3aGVuIHRoZXJlJ3Mgbm9cbiAqIGJvdW5kYXJ5IG1hdGNoLiBUd28gYm91bmRhcnkgZm9ybXMgYXJlIGFjY2VwdGVkOlxuICogLSBzbmFrZTogYDxjYW5kaWRhdGU+X2AgZm9sbG93ZWQgYnkgdGhlIHJlc3Qgb2YgdGhlIHBhdGggKGUuZy5cbiAqICAgYHRhc2tfcHJvamVjdF9pZGAgYWdhaW5zdCBjYW5kaWRhdGUgYHRhc2tgIHJldHVybnMgYHByb2plY3RfaWRgKS5cbiAqIC0gY2FtZWw6IGA8Y2FuZGlkYXRlPmAgaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgYW4gdXBwZXJjYXNlIGxldHRlcixcbiAqICAgd2hpY2ggbWFya3MgYSBuZXcgd29yZCBpbiBjYW1lbENhc2UgKGUuZy4gYHRhc2tQcm9qZWN0SWRgIGFnYWluc3RcbiAqICAgY2FuZGlkYXRlIGB0YXNrYCByZXR1cm5zIGBwcm9qZWN0SWRgIHdpdGggdGhlIGxlYWRpbmcgYFBgXG4gKiAgIGxvd2VyY2FzZWQgc28gdGhlIHJlbWFpbmRlciBzdGF5cyBpbiBjYWxsZXItZm9ybSBmb3IgdGhlIG5leHRcbiAqICAgYXR0cmlidXRlIC8gcmVsYXRpb25zaGlwIG1hdGNoKS5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFJlbWFpbmluZyByYW5zYWNrIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gY2FuZGlkYXRlIC0gUmVsYXRpb25zaGlwIG5hbWUgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVtYWluZGVyIGFmdGVyIHRoZSBjYW5kaWRhdGUsIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwUmVsYXRpb25zaGlwQ2FuZGlkYXRlKHZhbHVlLCBjYW5kaWRhdGUpIHtcbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoYCR7Y2FuZGlkYXRlfV9gKSkge1xuICAgIHJldHVybiB2YWx1ZS5zbGljZShjYW5kaWRhdGUubGVuZ3RoICsgMSlcbiAgfVxuXG4gIGlmICh2YWx1ZS5sZW5ndGggPD0gY2FuZGlkYXRlLmxlbmd0aCkgcmV0dXJuIG51bGxcbiAgaWYgKCF2YWx1ZS5zdGFydHNXaXRoKGNhbmRpZGF0ZSkpIHJldHVybiBudWxsXG5cbiAgY29uc3QgbmV4dENoYXIgPSB2YWx1ZS5jaGFyQXQoY2FuZGlkYXRlLmxlbmd0aClcblxuICBpZiAobmV4dENoYXIgPCBcIkFcIiB8fCBuZXh0Q2hhciA+IFwiWlwiKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBuZXh0Q2hhci50b0xvd2VyQ2FzZSgpICsgdmFsdWUuc2xpY2UoY2FuZGlkYXRlLmxlbmd0aCArIDEpXG59XG5cbi8qKlxuICogUnVucyByZWxhdGlvbnNoaXAgY2FuZGlkYXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nW119IC0gQ2FuZGlkYXRlIHRva2VucyBmb3IgbWF0Y2hpbmcuXG4gKi9cbmZ1bmN0aW9uIHJlbGF0aW9uc2hpcENhbmRpZGF0ZXMocmVsYXRpb25zaGlwTmFtZSkge1xuICByZXR1cm4gdW5pcXVuaXplKFtyZWxhdGlvbnNoaXBOYW1lLCBpbmZsZWN0aW9uLnVuZGVyc2NvcmUocmVsYXRpb25zaGlwTmFtZSldKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmFuc2Fja01vZGVsQ2xhc3N9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudmFsdWUgLSBBdHRyaWJ1dGUgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXNvbHZlZCBhdHRyaWJ1dGUgbmFtZS5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUF0dHJpYnV0ZU5hbWUoe21vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBjb2x1bW5OYW1lXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVFbnRyaWVzKG1vZGVsQ2xhc3MpKSkge1xuICAgIGlmIChtYXRjaGVzQXR0cmlidXRlVmFsdWUoe2F0dHJpYnV0ZU5hbWUsIGNvbHVtbk5hbWUsIHZhbHVlfSkpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJ1bnMgcmVsYXRpb25zaGlwIGVudHJpZXMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywge3RhcmdldE1vZGVsQ2xhc3M6IFJhbnNhY2tNb2RlbENsYXNzfT59IC0gUmVsYXRpb25zaGlwIGVudHJpZXMga2V5ZWQgYnkgbmFtZS5cbiAqL1xuZnVuY3Rpb24gcmVsYXRpb25zaGlwRW50cmllcyhtb2RlbENsYXNzKSB7XG4gIGlmICh0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKG1vZGVsQ2xhc3MpLmdldFJlbGF0aW9uc2hpcHNNYXAgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHJldHVybiBiYWNrZW5kUmVsYXRpb25zaGlwRW50cmllcyhtb2RlbENsYXNzKVxuICB9XG5cbiAgaWYgKHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobW9kZWxDbGFzcykucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMgPT09IFwiZnVuY3Rpb25cIiAmJlxuICAgIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobW9kZWxDbGFzcykucmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRSZWxhdGlvbnNoaXBFbnRyaWVzKG1vZGVsQ2xhc3MpXG4gIH1cblxuICByZXR1cm4ge31cbn1cblxuLyoqXG4gKiBSdW5zIGJhY2tlbmQgcmVsYXRpb25zaGlwIGVudHJpZXMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQmFja2VuZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dGFyZ2V0TW9kZWxDbGFzczogUmFuc2Fja01vZGVsQ2xhc3N9Pn0gLSBSZWxhdGlvbnNoaXAgZW50cmllcyBrZXllZCBieSBuYW1lLlxuICovXG5mdW5jdGlvbiBiYWNrZW5kUmVsYXRpb25zaGlwRW50cmllcyhtb2RlbENsYXNzKSB7XG4gIC8qKlxuICAgKiBFbnRyaWVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3RhcmdldE1vZGVsQ2xhc3M6IFJhbnNhY2tNb2RlbENsYXNzfT59ICovXG4gIGNvbnN0IGVudHJpZXMgPSB7fVxuICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKG1vZGVsQ2xhc3MpLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBzTWFwKSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcHNNYXBbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmICh0eXBlb2YgcmVsYXRpb25zaGlwLmlzUG9seW1vcnBoaWMgPT09IFwiZnVuY3Rpb25cIiAmJiByZWxhdGlvbnNoaXAuaXNQb2x5bW9ycGhpYygpKSBjb250aW51ZVxuXG4gICAgY29uc3QgcmF3VGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgY29udGludWVcblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsQ2xhc3MpXG4gICAgICAuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuXG4gICAgZW50cmllc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHt0YXJnZXRNb2RlbENsYXNzfVxuICB9XG5cbiAgcmV0dXJuIGVudHJpZXNcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIHJlbGF0aW9uc2hpcCBlbnRyaWVzLlxuICogQHBhcmFtIHtSYW5zYWNrTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0YXJnZXRNb2RlbENsYXNzOiBSYW5zYWNrTW9kZWxDbGFzc30+fSAtIFJlbGF0aW9uc2hpcCBlbnRyaWVzIGtleWVkIGJ5IG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kUmVsYXRpb25zaGlwRW50cmllcyhtb2RlbENsYXNzKSB7XG4gIC8qKlxuICAgKiBFbnRyaWVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3RhcmdldE1vZGVsQ2xhc3M6IFJhbnNhY2tNb2RlbENsYXNzfT59ICovXG4gIGNvbnN0IGVudHJpZXMgPSB7fVxuICBjb25zdCBkZWZpbml0aW9ucyA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChtb2RlbENsYXNzKS5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG4gIGNvbnN0IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcyA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChtb2RlbENsYXNzKS5yZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKVxuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhkZWZpbml0aW9ucykpIHtcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBNb2RlbENsYXNzZXNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICBlbnRyaWVzW3JlbGF0aW9uc2hpcE5hbWVdID0ge3RhcmdldE1vZGVsQ2xhc3N9XG4gIH1cblxuICByZXR1cm4gZW50cmllc1xufVxuXG4vKipcbiAqIFJ1bnMgYXR0cmlidXRlIGVudHJpZXMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBBdHRyaWJ1dGUtdG8tY29sdW1uIGVudHJpZXMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGF0dHJpYnV0ZUVudHJpZXMobW9kZWxDbGFzcykge1xuICBpZiAodHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChtb2RlbENsYXNzKS5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChtb2RlbENsYXNzKS5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKCkpKVxuICB9XG5cbiAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKG1vZGVsQ2xhc3MpLnJlc291cmNlQ29uZmlnID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChtb2RlbENsYXNzKS5yZXNvdXJjZUNvbmZpZygpXG4gICAgOiB7fVxuICBjb25zdCBhdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuYXR0cmlidXRlc1xuICAvKipcbiAgICogRW50cmllcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGVudHJpZXMgPSB7fVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikgY29udGludWVcblxuICAgICAgZW50cmllc1thdHRyaWJ1dGVOYW1lXSA9IGF0dHJpYnV0ZU5hbWVcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzKSkge1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSkge1xuICAgICAgZW50cmllc1thdHRyaWJ1dGVOYW1lXSA9IGF0dHJpYnV0ZU5hbWVcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZW50cmllc1xufVxuXG4vKipcbiAqIFJ1bnMgbWF0Y2hlcyBhdHRyaWJ1dGUgdmFsdWUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNhbmRpZGF0ZSByZXNvbHZlcyB0byB0aGUgYXR0cmlidXRlLlxuICovXG5mdW5jdGlvbiBtYXRjaGVzQXR0cmlidXRlVmFsdWUoe2F0dHJpYnV0ZU5hbWUsIGNvbHVtbk5hbWUsIHZhbHVlfSkge1xuICByZXR1cm4gdW5pcXVuaXplKFtcbiAgICBhdHRyaWJ1dGVOYW1lLFxuICAgIGNvbHVtbk5hbWUsXG4gICAgaW5mbGVjdGlvbi51bmRlcnNjb3JlKGF0dHJpYnV0ZU5hbWUpLFxuICAgIGluZmxlY3Rpb24udW5kZXJzY29yZShjb2x1bW5OYW1lKVxuICBdKS5pbmNsdWRlcyh2YWx1ZSlcbn1cblxuLyoqXG4gKiBSdW5zIHBhcnNlIHJhbnNhY2sga2V5LlxuICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFJhbnNhY2sga2V5LlxuICogQHJldHVybnMge3twYXRoVmFsdWU6IHN0cmluZywgcHJlZGljYXRlOiBSYW5zYWNrUHJlZGljYXRlfSB8IG51bGx9IC0gUGFyc2VkIGtleS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VSYW5zYWNrS2V5KGtleSkge1xuICBmb3IgKGNvbnN0IHByZWRpY2F0ZSBvZiBzdXBwb3J0ZWRQcmVkaWNhdGVzKSB7XG4gICAgY29uc3Qgc3VmZml4ID0gYF8ke3ByZWRpY2F0ZX1gXG4gICAgaWYgKCFrZXkuZW5kc1dpdGgoc3VmZml4KSkgY29udGludWVcblxuICAgIGNvbnN0IHBhdGhWYWx1ZSA9IGtleS5zbGljZSgwLCBrZXkubGVuZ3RoIC0gc3VmZml4Lmxlbmd0aClcblxuICAgIGlmIChwYXRoVmFsdWUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYEludmFsaWQgcmFuc2FjayBrZXk6ICR7a2V5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdGhWYWx1ZSxcbiAgICAgIHByZWRpY2F0ZTogLyoqIEB0eXBlIHtSYW5zYWNrUHJlZGljYXRlfSAqLyAocHJlZGljYXRlKVxuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgcHJlZGljYXRlIG9mIHN1cHBvcnRlZFByZWRpY2F0ZXMpIHtcbiAgICBjb25zdCBjYW1lbFN1ZmZpeCA9IHNuYWtlVG9DYW1lbFN1ZmZpeChwcmVkaWNhdGUpXG5cbiAgICBpZiAoIWtleS5lbmRzV2l0aChjYW1lbFN1ZmZpeCkpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBwYXRoVmFsdWUgPSBrZXkuc2xpY2UoMCwga2V5Lmxlbmd0aCAtIGNhbWVsU3VmZml4Lmxlbmd0aClcblxuICAgIGlmIChwYXRoVmFsdWUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYEludmFsaWQgcmFuc2FjayBrZXk6ICR7a2V5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdGhWYWx1ZSxcbiAgICAgIHByZWRpY2F0ZTogLyoqIEB0eXBlIHtSYW5zYWNrUHJlZGljYXRlfSAqLyAocHJlZGljYXRlKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBzbmFrZSB0byBjYW1lbCBzdWZmaXguXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBTbmFrZS1jYXNlIHByZWRpY2F0ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ2FtZWxDYXNlIHByZWRpY2F0ZSBzdWZmaXggdXNlZCBpbiByYW5zYWNrIGtleXMuXG4gKi9cbmZ1bmN0aW9uIHNuYWtlVG9DYW1lbFN1ZmZpeCh2YWx1ZSkge1xuICBjb25zdCBzZWdtZW50cyA9IHZhbHVlLnNwbGl0KFwiX1wiKVxuXG4gIHJldHVybiBzZWdtZW50cy5tYXAoKHNlZ21lbnQpID0+IHNlZ21lbnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBzZWdtZW50LnNsaWNlKDEpKS5qb2luKFwiXCIpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmFuc2FjayB2YWx1ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7UmFuc2Fja1ByZWRpY2F0ZX0gYXJncy5wcmVkaWNhdGUgLSBQYXJzZWQgcHJlZGljYXRlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFJhdyB2YWx1ZS5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSYW5zYWNrVmFsdWUoe3ByZWRpY2F0ZSwgdmFsdWV9KSB7XG4gIGlmIChwcmVkaWNhdGUgPT09IFwibnVsbFwiKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVJhbnNhY2tOdWxsVmFsdWUodmFsdWUpXG4gIH1cblxuICBpZiAocHJlZGljYXRlID09PSBcImluXCIgfHwgcHJlZGljYXRlID09PSBcIm5vdF9pblwiKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVJhbnNhY2tMaXN0VmFsdWUodmFsdWUpXG4gIH1cblxuICBpZiAocmFuc2Fja1ZhbHVlSXNCbGFuayh2YWx1ZSkpIHJldHVybiBTS0lQX1JBTlNBQ0tfQ09ORElUSU9OXG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgcmFuc2FjayBudWxsIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgbnVsbCBwcmVkaWNhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbiB8IHR5cGVvZiBTS0lQX1JBTlNBQ0tfQ09ORElUSU9OfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJhbnNhY2tOdWxsVmFsdWUodmFsdWUpIHtcbiAgY29uc3QgYm9vbGVhblZhbHVlID0gbm9ybWFsaXplUmFuc2Fja0Jvb2xlYW4odmFsdWUpXG5cbiAgcmV0dXJuIGJvb2xlYW5WYWx1ZSA9PT0gbnVsbCA/IFNLSVBfUkFOU0FDS19DT05ESVRJT04gOiBib29sZWFuVmFsdWVcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByYW5zYWNrIGxpc3QgdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBsaXN0IHByZWRpY2F0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB0eXBlb2YgU0tJUF9SQU5TQUNLX0NPTkRJVElPTn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSYW5zYWNrTGlzdFZhbHVlKHZhbHVlKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRBcnJheSA9IG5vcm1hbGl6ZVJhbnNhY2tBcnJheSh2YWx1ZSlcblxuICByZXR1cm4gbm9ybWFsaXplZEFycmF5Lmxlbmd0aCA8IDEgPyBTS0lQX1JBTlNBQ0tfQ09ORElUSU9OIDogbm9ybWFsaXplZEFycmF5XG59XG5cbi8qKlxuICogUmFuc2FjayB0cnVlIHZhbHVlcy5cbiAqIEB0eXBlIHtTZXQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuY29uc3QgcmFuc2Fja1RydWVWYWx1ZXMgPSBuZXcgU2V0KFt0cnVlLCAxLCBcIjFcIiwgXCJ0cnVlXCJdKVxuLyoqXG4gKiBSYW5zYWNrIGZhbHNlIHZhbHVlcy5cbiAqIEB0eXBlIHtTZXQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuY29uc3QgcmFuc2Fja0ZhbHNlVmFsdWVzID0gbmV3IFNldChbZmFsc2UsIDAsIFwiMFwiLCBcImZhbHNlXCJdKVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJhbnNhY2sgYm9vbGVhbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGJvb2xlYW4uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbiB8IG51bGx9IC0gTm9ybWFsaXplZCBib29sZWFuIG9yIG51bGwgd2hlbiBibGFuay5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmFuc2Fja0Jvb2xlYW4odmFsdWUpIHtcbiAgaWYgKHJhbnNhY2tUcnVlVmFsdWVzLmhhcyh2YWx1ZSkpIHJldHVybiB0cnVlXG4gIGlmIChyYW5zYWNrRmFsc2VWYWx1ZXMuaGFzKHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gIGlmIChyYW5zYWNrVmFsdWVJc0JsYW5rKHZhbHVlKSkgcmV0dXJuIG51bGxcblxuICB0aHJvdyByYW5zYWNrUXVlcnlFcnJvcihgSW52YWxpZCByYW5zYWNrIGJvb2xlYW4gdmFsdWU6ICR7U3RyaW5nKHZhbHVlKX1gKVxufVxuXG4vKipcbiAqIFJ1bnMgcmFuc2FjayB2YWx1ZSBpcyBibGFuay5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBzaG91bGQgYmUgaWdub3JlZCBhcyBibGFuay5cbiAqL1xuZnVuY3Rpb24gcmFuc2Fja1ZhbHVlSXNCbGFuayh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gXCJcIlxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJhbnNhY2sgYXJyYXkuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBhcnJheS1pc2ggdmFsdWUuXG4gKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE5vcm1hbGl6ZWQgYXJyYXkgdmFsdWVzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSYW5zYWNrQXJyYXkodmFsdWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICE9PSB1bmRlZmluZWQgJiYgZW50cnkgIT09IG51bGwgJiYgZW50cnkgIT09IFwiXCIpXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKGVudHJ5KSA9PiBlbnRyeS50cmltKCkpLmZpbHRlcigoZW50cnkpID0+IGVudHJ5Lmxlbmd0aCA+IDApXG4gIH1cblxuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIFtdXG5cbiAgcmV0dXJuIFt2YWx1ZV1cbn1cblxuLyoqXG4gKiBQYXJzZXMgYSByYW5zYWNrIGBzYCBzb3J0IHN0cmluZyBhZ2FpbnN0IG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge1JhbnNhY2tNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgZm9yIGF0dHJpYnV0ZSBsb29rdXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gc29ydFN0cmluZyAtIFJhbnNhY2sgc29ydCBzdHJpbmcgKGUuZy4sIFwibmFtZSBhc2NcIiBvciBcIm5hbWUgYXNjLCBjcmVhdGVkQXQgZGVzY1wiKS5cbiAqIEByZXR1cm5zIHtSYW5zYWNrU29ydFtdfSAtIFBhcnNlZCBzb3J0IGRlZmluaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSYW5zYWNrU29ydChtb2RlbENsYXNzLCBzb3J0U3RyaW5nKSB7XG4gIGNvbnN0IHNlZ21lbnRzID0gc29ydFN0cmluZy5zcGxpdChcIixcIikubWFwKChzZWdtZW50KSA9PiBzZWdtZW50LnRyaW0oKSkuZmlsdGVyKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA+IDApXG5cbiAgLyoqXG4gICAqIFNvcnRzLlxuICAgKiBAdHlwZSB7UmFuc2Fja1NvcnRbXX0gKi9cbiAgY29uc3Qgc29ydHMgPSBbXVxuXG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgIGNvbnN0IHBhcnRzID0gc2VnbWVudC5zcGxpdCgvXFxzKy8pXG4gICAgY29uc3QgY29sdW1uQ2FuZGlkYXRlID0gcGFydHNbMF1cbiAgICBjb25zdCBkaXJlY3Rpb25DYW5kaWRhdGUgPSBwYXJ0cy5sZW5ndGggPiAxID8gcGFydHNbMV0udG9Mb3dlckNhc2UoKSA6IFwiYXNjXCJcblxuICAgIGlmIChkaXJlY3Rpb25DYW5kaWRhdGUgIT09IFwiYXNjXCIgJiYgZGlyZWN0aW9uQ2FuZGlkYXRlICE9PSBcImRlc2NcIikge1xuICAgICAgdGhyb3cgcmFuc2Fja1F1ZXJ5RXJyb3IoYEludmFsaWQgcmFuc2FjayBzb3J0IGRpcmVjdGlvbiBcIiR7ZGlyZWN0aW9uQ2FuZGlkYXRlfVwiIGluOiAke3NlZ21lbnR9YClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZSA9IHJlc29sdmVBdHRyaWJ1dGVOYW1lKHttb2RlbENsYXNzLCB2YWx1ZTogY29sdW1uQ2FuZGlkYXRlfSlcblxuICAgIGlmICghcmVzb2x2ZWRBdHRyaWJ1dGUpIHtcbiAgICAgIHRocm93IHJhbnNhY2tRdWVyeUVycm9yKGBVbmtub3duIHJhbnNhY2sgc29ydCBhdHRyaWJ1dGUgXCIke2NvbHVtbkNhbmRpZGF0ZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBzb3J0cy5wdXNoKHthdHRyaWJ1dGU6IHJlc29sdmVkQXR0cmlidXRlLCBkaXJlY3Rpb246IGRpcmVjdGlvbkNhbmRpZGF0ZX0pXG4gIH1cblxuICByZXR1cm4gc29ydHNcbn1cblxuLyoqXG4gKiBSdW5zIHVuaXF1bml6ZS5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHZhbHVlcyAtIElucHV0IHZhbHVlcy5cbiAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBVbmlxdWUgdmFsdWVzIGluIG9yaWdpbmFsIG9yZGVyLlxuICovXG5mdW5jdGlvbiB1bmlxdW5pemUodmFsdWVzKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodmFsdWVzKSlcbn1cbiJdfQ==