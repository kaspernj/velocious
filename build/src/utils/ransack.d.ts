export type RansackPredicate = "cont" | "end" | "eq" | "gt" | "gteq" | "in" | "lt" | "lteq" | "not_eq" | "not_in" | "null" | "start";
export type RansackCombinator = "and" | "or";
export type RansackModelClass = typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass;
export type RansackAttribute = {
    /**
     * - Resolved attribute name.
     */
    attributeName: string;
    /**
     * - Resolved relationship path.
     */
    path: string[];
};
export type RansackCondition = {
    /**
     * - Resolved attributes to test.
     */
    attributes: RansackAttribute[];
    /**
     * - How multiple attributes are combined.
     */
    combinator: RansackCombinator;
    /**
     * - Parsed Ransack predicate.
     */
    predicate: RansackPredicate;
    /**
     * - Normalized value.
     */
    value: ReturnType<typeof JSON.parse>;
};
export type RansackGroup = {
    /**
     * - How entries inside this group are combined.
     */
    combinator: RansackCombinator;
    /**
     * - Conditions in this group.
     */
    conditions: RansackCondition[];
    /**
     * - Nested groups.
     */
    groupings: RansackGroup[];
};
export type RansackSort = {
    /**
     * - Resolved attribute name.
     */
    attribute: string;
    /**
     * - Sort direction.
     */
    direction: "asc" | "desc";
};
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
export declare class RansackQueryError extends Error {
    /**
     * Creates a Ransack query error.
     * @param {string} message - Error message.
     */
    constructor(message: string);
}
/**
 * Runs the normalizeRansackParams helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
export declare function normalizeRansackParams(modelClass: RansackModelClass, params: Record<string, ReturnType<typeof JSON.parse>>): RansackCondition[];
/**
 * Runs the normalizeRansackGroup helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
 * @returns {RansackGroup} - Normalized group.
 */
export declare function normalizeRansackGroup(modelClass: RansackModelClass, params: Record<string, ReturnType<typeof JSON.parse>>): RansackGroup;
/**
 * Parses a ransack `s` sort string against model attributes.
 * @param {RansackModelClass} modelClass - Model class for attribute lookup.
 * @param {string} sortString - Ransack sort string (e.g., "name asc" or "name asc, createdAt desc").
 * @returns {RansackSort[]} - Parsed sort definitions.
 */
export declare function parseRansackSort(modelClass: RansackModelClass, sortString: string): RansackSort[];
//# sourceMappingURL=ransack.d.ts.map