import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectPlain extends SelectBase {
    plain: string;
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain: string);
    toSql(): string;
}
//# sourceMappingURL=select-plain.d.ts.map