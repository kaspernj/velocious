import WhereBase from "./where-base.js";
export default class VelociousDatabaseQueryWhereHash extends WhereBase {
    plain: string;
    query: import("./index.js").default;
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {string} plain - Plain.
     */
    constructor(query: import("./index.js").default, plain: string);
    toSql(): string;
}
//# sourceMappingURL=where-plain.d.ts.map