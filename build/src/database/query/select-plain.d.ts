import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
    plain: string;
    alias: string | undefined;
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain: string);
    /**
     * Returns the explicit terminal AS alias parsed at the raw-select boundary.
     * @returns {string | undefined} - Explicit terminal AS alias, or undefined when absent.
     */
    getAlias(): string | undefined;
    toSql(): string;
}
//# sourceMappingURL=select-plain.d.ts.map