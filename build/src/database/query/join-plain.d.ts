import JoinBase from "./join-base.js";
export default class VelociousDatabaseQueryJoinPlain extends JoinBase {
    plain: string;
    /**
     * Runs constructor.
     * @param {string} plain - Plain.
     */
    constructor(plain: string);
    toSql(): string;
}
//# sourceMappingURL=join-plain.d.ts.map