import FromBase from "./from-base.js";
export default class VelociousDatabaseQueryFromPlain extends FromBase {
    plain: string;
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain: string);
    toSql(): string[];
}
//# sourceMappingURL=from-plain.d.ts.map