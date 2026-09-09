import BaseColumnsIndex from "../base-columns-index.js";
import TableIndex from "../../table-data/table-index.js";
export default class VelociousDatabaseDriversSqliteColumnsIndex extends BaseColumnsIndex {
    getColumnNames(): any;
    getName(): any;
    getTableDataIndex(): TableIndex;
    isPrimaryKey(): boolean;
    isUnique(): boolean;
}
//# sourceMappingURL=columns-index.d.ts.map