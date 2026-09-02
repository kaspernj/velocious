import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereNot extends WhereBase {
    where: WhereBase;
    query: import("./index.js").default;
    /**
     * Runs constructor.
     * @param {import("./where-base.js").default} where - Where clause.
     */
    constructor(where: import("./where-base.js").default);
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql(): string;
}
//# sourceMappingURL=where-not.d.ts.map