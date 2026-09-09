import SelectBase from "./select-base.js";
export default class VelociousDatabaseQuerySelectTableAndColumn extends SelectBase {
    columnName: string;
    tableName: string;
    /**
     * Runs constructor.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     */
    constructor(tableName: string, columnName: string);
    getColumnName(): string;
    getTableName(): string;
    toSql(): string;
}
//# sourceMappingURL=select-table-and-column.d.ts.map