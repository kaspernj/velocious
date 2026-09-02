import WhereBase from "./where-base.js";
export type WhereHash = {
    [key: string]: string | number | boolean | null | Array<string | number | boolean | null> | Record<string, ReturnType<typeof JSON.parse>>;
};
export default class VelociousDatabaseQueryWhereModelClassHash extends WhereBase {
    hash: WhereHash;
    modelClass: typeof import("../record/index.js").default;
    qualifyBaseTable: boolean;
    query: import("./index.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./index.js").default} args.query - Query instance.
     * @param {WhereHash} args.hash - Hash.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {boolean} [args.qualifyBaseTable] - Whether to qualify base table columns.
     */
    constructor({ query, hash, modelClass, qualifyBaseTable }: {
        query: import("./index.js").default;
        hash: WhereHash;
        modelClass: typeof import("../record/index.js").default;
        qualifyBaseTable?: boolean;
    });
    /**
     * Runs get model class.
     * @returns {typeof import("../record/index.js").default} - The model class.
     */
    getModelClass(): typeof import("../record/index.js").default;
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql(): string;
    /**
     * Runs resolve column name.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} key - Attribute or column name.
     * @returns {string | undefined} - The resolved column name.
     */
    _resolveColumnName(modelClass: typeof import("../record/index.js").default, key: string): string | undefined;
    /**
     * Runs get relationship.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("../record/relationships/base.js").default | undefined} - The relationship.
     */
    _getRelationship(modelClass: typeof import("../record/index.js").default, relationshipName: string): import("../record/relationships/base.js").default | undefined;
    /**
     * Runs is relationship where operator tuple.
     * @param {ReturnType<typeof JSON.parse>} tupleValue - Candidate tuple.
     * @returns {boolean} - Whether this is a relationship where tuple.
     */
    _isRelationshipWhereOperatorTuple(tupleValue: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs normalize relationship where operator tuples.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate relationship where value.
     * @returns {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} - Normalized tuples.
     */
    _normalizeRelationshipWhereOperatorTuples(value: ReturnType<typeof JSON.parse>): Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>;
    /**
     * Runs is relationship where operator tuple container.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate relationship where value.
     * @returns {boolean} - Whether value can be normalized to relationship tuples.
     */
    _isRelationshipWhereOperatorTupleContainer(value: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs where sqlfrom relationship where operator tuples.
     * @param {object} args - Relationship where options.
     * @param {typeof import("../record/index.js").default} args.modelClass - Relationship model class.
     * @param {string} args.tableName - Relationship table reference name.
     * @param {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} args.tuples - Operator tuples.
     * @returns {string} - SQL where fragment.
     */
    _whereSQLFromRelationshipWhereOperatorTuples({ modelClass, tableName, tuples }: {
        modelClass: typeof import("../record/index.js").default;
        tableName: string;
        tuples: Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>;
    }): string;
    /**
     * Runs normalize sqlite boolean value.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeSqliteBooleanValue({ modelClass, columnName, value }: {
        modelClass: typeof import("../record/index.js").default;
        columnName: string;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs normalize value for column type.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeValueForColumnType({ modelClass, columnName, value }: {
        modelClass: typeof import("../record/index.js").default;
        columnName: string;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs where sqlfrom hash.
     * @param {WhereHash} hash - Hash.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string[]} path - Join path.
     * @param {string} [tableName] - Table name.
     * @param {number} index - Index value.
     * @returns {string} - SQL string.
     */
    _whereSQLFromHash(hash: WhereHash, modelClass: typeof import("../record/index.js").default, path: string[], tableName?: string, index?: number): string;
}
//# sourceMappingURL=where-model-class-hash.d.ts.map