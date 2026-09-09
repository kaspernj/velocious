import AlterTableBase from "../../../query/alter-table-base.js";
export default class VelociousDatabaseConnectionDriversMysqlSqlAlterTable extends AlterTableBase {
    /**
     * Runs get drop foreign key sql.
     * @param {import("../../../table-data/table-foreign-key.js").default} foreignKey - Foreign key to drop.
     * @returns {string} - SQL fragment that removes the foreign key.
     */
    getDropForeignKeySQL(foreignKey: import("../../../table-data/table-foreign-key.js").default): string;
    /**
     * Builds MySQL ALTER TABLE statements, adding indexes atomically with columns.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=alter-table.d.ts.map