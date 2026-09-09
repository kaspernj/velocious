import WhereBase from "./where-base.js";
export type WhereHash = {
    [key: string]: string | number | boolean | null | Array<string | number | boolean | null> | WhereHash;
};
/**
 * VelociousDatabaseQueryWhereHash class.
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | WhereHash}} WhereHash
 */
export default class VelociousDatabaseQueryWhereHash extends WhereBase {
    hash: WhereHash;
    query: import("./index.js").default;
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {WhereHash} hash - Hash.
     */
    constructor(query: import("./index.js").default, hash: WhereHash);
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql(): string;
    /**
     * Runs where sqlfrom hash.
     * @param {WhereHash} hash - Hash.
     * @param {string} [tableName] - Table name.
     * @param {number} index - Index value.
     * @returns {string} - SQL string.
     */
    _whereSQLFromHash(hash: WhereHash, tableName?: string, index?: number): string;
}
//# sourceMappingURL=where-hash.d.ts.map