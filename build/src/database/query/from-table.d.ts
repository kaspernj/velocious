import FromBase from "./from-base.js";
export default class VelociousDatabaseQueryFromTable extends FromBase {
    tableName: string;
    /**
     * Runs constructor.
     * @param {string} tableName - Table name.
     */
    constructor(tableName: string);
    toSql(): string[];
}
//# sourceMappingURL=from-table.d.ts.map