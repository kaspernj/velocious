export type ModelPrimaryKeyScalar = string | number;
export type ModelPrimaryKeyDefinition = string | string[];
export type CompositeModelPrimaryKeyValue = Record<string, ModelPrimaryKeyScalar>;
export type ModelPrimaryKeyValue = ModelPrimaryKeyScalar | CompositeModelPrimaryKeyValue;
/** @typedef {string | number} ModelPrimaryKeyScalar */
/** @typedef {string | string[]} ModelPrimaryKeyDefinition */
/** @typedef {Record<string, ModelPrimaryKeyScalar>} CompositeModelPrimaryKeyValue */
/** @typedef {ModelPrimaryKeyScalar | CompositeModelPrimaryKeyValue} ModelPrimaryKeyValue */
/**
 * Validates an untrusted composite identity and returns its definition-ordered values.
 * @param {string[]} primaryKey - Composite primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {CompositeModelPrimaryKeyValue} - Validated identity.
 */
export declare function validatedCompositePrimaryKeyValue(primaryKey: string[], value: ReturnType<typeof JSON.parse>): CompositeModelPrimaryKeyValue;
/**
 * Returns a scalar primary-key definition or fails at a feature boundary that cannot represent composite identities.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {string} operation - Operation requiring a scalar identity.
 * @returns {string} - Scalar primary-key column or attribute name.
 */
export declare function scalarModelPrimaryKey(primaryKey: ModelPrimaryKeyDefinition, operation: string): string;
/**
 * Returns a scalar identity or fails at a feature boundary that cannot represent composite identities.
 * @param {ModelPrimaryKeyValue} value - Model identity.
 * @param {string} operation - Operation requiring a scalar identity.
 * @returns {ModelPrimaryKeyScalar} - Scalar identity.
 */
export declare function scalarModelPrimaryKeyValue(value: ModelPrimaryKeyValue, operation: string): ModelPrimaryKeyScalar;
/**
 * Builds query conditions from a scalar or composite model identity.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {Record<string, ModelPrimaryKeyScalar>} - Primary-key query conditions.
 */
export declare function modelPrimaryKeyConditions(primaryKey: ModelPrimaryKeyDefinition, value: ReturnType<typeof JSON.parse>): Record<string, ModelPrimaryKeyScalar>;
/**
 * Builds a qualified SQL predicate matching any supplied composite identity.
 * @param {object} args - Arguments.
 * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class owning the identity attributes.
 * @param {string[]} args.primaryKey - Composite primary-key definition.
 * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query receiving the predicate.
 * @param {ModelPrimaryKeyValue[]} args.values - Candidate identities.
 * @returns {string} - Qualified SQL predicate.
 */
export declare function compositeModelPrimaryKeyCohortSql({ modelClass, primaryKey, query, values }: {
    modelClass: typeof import("../database/record/index.js").default;
    primaryKey: string[];
    query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    values: ModelPrimaryKeyValue[];
}): string;
/**
 * Reads a scalar or composite identity through the owning model's value reader.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {(key: string) => ReturnType<typeof JSON.parse>} read - Primary-key value reader.
 * @returns {ModelPrimaryKeyValue} - Model identity.
 */
export declare function readModelPrimaryKeyValue(primaryKey: ModelPrimaryKeyDefinition, read: (key: string) => ReturnType<typeof JSON.parse>): ModelPrimaryKeyValue;
/**
 * Returns an unambiguous map key while preserving legacy scalar map keys.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {string} - Canonical identity key.
 */
export declare function modelPrimaryKeyCacheKey(primaryKey: ModelPrimaryKeyDefinition, value: ReturnType<typeof JSON.parse>): string;
/**
 * Restores a model identity from its canonical string representation.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {string} cacheKey - Canonical identity key.
 * @returns {ModelPrimaryKeyValue} - Restored identity.
 */
export declare function modelPrimaryKeyValueFromCacheKey(primaryKey: ModelPrimaryKeyDefinition, cacheKey: string): ModelPrimaryKeyValue;
//# sourceMappingURL=model-primary-key.d.ts.map