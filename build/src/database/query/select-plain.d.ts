import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
    plain: string;
    alias: string | undefined;
    aliasQuoted: boolean;
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain: string);
    /**
     * Returns the explicit terminal AS alias parsed at the raw-select boundary.
     * @param {{getType: () => string}} driver - Driver that determines returned identifier spelling.
     * @returns {string | undefined} - Driver-returned terminal AS alias, or undefined when absent.
     */
    getAlias(driver: {
        getType: () => string;
    }): string | undefined;
    toSql(): string;
}
//# sourceMappingURL=select-plain.d.ts.map