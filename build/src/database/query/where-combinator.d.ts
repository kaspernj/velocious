import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereCombinator extends WhereBase {
    combinator: "and" | "or";
    query: import("./index.js").default;
    wheres: WhereBase[];
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {"and" | "or"} args.combinator - SQL boolean combinator.
     * @param {import("./index.js").default} args.query - Query instance.
     * @param {import("./where-base.js").default[]} args.wheres - Where clauses to combine.
     */
    constructor({ combinator, query, wheres }: {
        combinator: "and" | "or";
        query: import("./index.js").default;
        wheres: import("./where-base.js").default[];
    });
    /**
     * Returns the toSql result.
     * @returns {string} - SQL string.
     */
    toSql(): string;
}
//# sourceMappingURL=where-combinator.d.ts.map