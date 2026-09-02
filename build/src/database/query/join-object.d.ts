import JoinBase from "./join-base.js";
export type JoinObjectInput = {
    [key: string]: boolean | string | string[] | JoinObjectInput;
};
export type JoinObject = {
    [key: string]: boolean | JoinObject;
};
/**
 * VelociousDatabaseQueryJoinObject class.
 * @typedef {{[key: string]: boolean | string | string[] | JoinObjectInput}} JoinObjectInput
 * @typedef {{[key: string]: boolean | JoinObject}} JoinObject
 */
export default class VelociousDatabaseQueryJoinObject extends JoinBase {
    object: JoinObject;
    basePath: string[];
    /**
     * Runs constructor.
     * @param {JoinObject} object - Object.
     * @param {string[]} [basePath] - Join base path relative to the root query.
     */
    constructor(object: JoinObject, basePath?: string[]);
    toSql(): string;
    /**
     * Runs join object.
     * @param {JoinObject} join - Join.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} sql - SQL string.
     * @param {number} joinsCount - Joins count.
     * @param {string[]} path - Join path.
     * @returns {string} - The join object.
     */
    joinObject(join: JoinObject, modelClass: typeof import("../record/index.js").default, sql: string, joinsCount: number, path: string[]): string;
    /**
     * Runs scope sql.
     * @param {object} args - Options object.
     * @param {import("../record/relationships/base.js").default} args.relationship - Relationship definition.
     * @param {import("./model-class-query.js").default} args.query - Model class query.
     * @param {typeof import("../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.joinPath - Join path.
     * @param {string} args.targetTableRef - Target table reference.
     * @returns {string} - Scope SQL.
     */
    _scopeSql({ relationship, query, targetModelClass, joinPath, targetTableRef }: {
        relationship: import("../record/relationships/base.js").default;
        query: import("./model-class-query.js").default;
        targetModelClass: typeof import("../record/index.js").default;
        joinPath: string[];
        targetTableRef: string;
    }): string;
    /**
     * Runs scope sql for where.
     * @param {import("./where-base.js").default} where - Where.
     * @param {string} targetTableRef - Target table reference.
     * @returns {string} - Scope where SQL.
     */
    _scopeSqlForWhere(where: import("./where-base.js").default, targetTableRef: string): string;
}
//# sourceMappingURL=join-object.d.ts.map