export default class TableForeignKey {
    _columnName: string;
    _dropForeignKey: boolean | undefined;
    _isNewForeignKey: boolean | undefined;
    _name: string | undefined;
    _tableName: string;
    _referencedColumnName: string;
    _referencedTableName: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.columnName - Column name.
     * @param {boolean} [args.dropForeignKey] - Whether to drop this foreign key.
     * @param {boolean} [args.isNewForeignKey] - Whether is new foreign key.
     * @param {string} [args.name] - Name.
     * @param {string} args.tableName - Table name.
     * @param {string} args.referencedColumnName - Referenced column name.
     * @param {string} args.referencedTableName - Referenced table name.
     */
    constructor({ columnName, dropForeignKey, isNewForeignKey, name, tableName, referencedColumnName, referencedTableName, ...restArgs }: {
        columnName: string;
        dropForeignKey?: boolean;
        isNewForeignKey?: boolean;
        name?: string;
        tableName: string;
        referencedColumnName: string;
        referencedTableName: string;
    });
    /**
     * Runs get column name.
     * @returns {string} - The column name.
     */
    getColumnName(): string;
    /**
     * Runs get drop foreign key.
     * @returns {boolean} - Whether this foreign key should be dropped.
     */
    getDropForeignKey(): boolean;
    /**
     * Runs get is new foreign key.
     * @returns {boolean} - Whether is new foreign key.
     */
    getIsNewForeignKey(): boolean;
    /**
     * Runs get table name.
     * @returns {string} - The table name.
     */
    getTableName(): string;
    /**
     * Runs get referenced column name.
     * @returns {string} - The referenced column name.
     */
    getReferencedColumnName(): string;
    /**
     * Runs get referenced table name.
     * @returns {string} - The referenced table name.
     */
    getReferencedTableName(): string;
    /**
     * Runs get name.
     * @returns {string} - The name.
     */
    getName(): string;
    /**
     * Runs set name.
     * @param {string} newName - New name.
     * @returns {void} - No return value.
     */
    setName(newName: string): void;
}
//# sourceMappingURL=table-foreign-key.d.ts.map