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
    toSql(): string;
}
//# sourceMappingURL=order-plain.d.ts.map