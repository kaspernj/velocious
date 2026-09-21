import OrderBase from "./order-base.js";
export default class VelociousDatabaseQueryOrderPlain extends OrderBase {
    plain: string;
    reverseOrder: boolean;
    /**
     * Runs constructor.
     * @param {import("./index.js").default} query - Query instance.
     * @param {string} plain - Plain.
     */
    constructor(query: import("./index.js").default, plain: string);
    setReverseOrder(): void;
    /**
     * Runs reversed copy.
     * @returns {VelociousDatabaseQueryOrderPlain} - A new independent order reversing the effective (rendered) direction; a directionless plain order renders DESC.
     */
    reversedCopy(): VelociousDatabaseQueryOrderPlain;
    toSql(): string;
}
//# sourceMappingURL=order-plain.d.ts.map