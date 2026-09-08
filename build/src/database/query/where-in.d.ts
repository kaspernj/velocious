export type InValue = string | number | boolean | null;
/** @typedef {string | number | boolean | null} InValue */
export default class WhereIn {
    /**
     * Validates an explicit membership descriptor at a column boundary.
     * @param {unknown} condition - Untrusted column condition, narrowed before use.
     * @returns {InValue[]} - Validated members in a new array.
     */
    static values(condition: unknown): InValue[];
    /**
     * Renders membership without letting its null branch escape sibling filters.
     * @param {{columnSql: string, inColumnSql?: string, values: InValue[], options: import("../query-parser/options.js").default}} args - Quoted column operands, normalized members and driver quoting.
     * @returns {string} - Complete membership predicate.
     */
    static toSql({ columnSql, inColumnSql, values, options }: {
        columnSql: string;
        inColumnSql?: string;
        values: InValue[];
        options: import("../query-parser/options.js").default;
    }): string;
}
//# sourceMappingURL=where-in.d.ts.map