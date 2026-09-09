export type ChangeTableAddIndexArgsType = {
    /**
     * - Skip creation if the index already exists.
     */
    ifNotExists?: boolean;
    /**
     * - Explicit index name to use.
     */
    name?: string;
    /**
     * - Whether the index should be unique.
     */
    unique?: boolean;
};
export type ChangeTableRemoveIndexArgsType = {
    /**
     * - Explicit index name to remove.
     */
    name?: string;
};
export type ChangeTableRemoveReferenceArgsType = {
    /**
     * - Override the derived reference column name.
     */
    columnName?: string;
    /**
     * - Explicit generated index name to remove.
     */
    indexName?: string;
};
export type ChangeTableAddColumnOperationType = {
    /**
     * - Operation type.
     */
    type: "addColumn";
    /**
     * - Column name.
     */
    columnName: string;
    /**
     * - Column type.
     */
    columnType: string;
    /**
     * - Column args.
     */
    args: import("../table-data/table-column.js").TableColumnArgsType | undefined;
};
export type ChangeTableRemoveColumnOperationType = {
    /**
     * - Operation type.
     */
    type: "removeColumn";
    /**
     * - Column name.
     */
    columnName: string;
};
export type ChangeTableAddIndexOperationType = {
    /**
     * - Operation type.
     */
    type: "addIndex";
    /**
     * - Columns to index.
     */
    columns: Array<string | import("../table-data/table-column.js").default>;
    /**
     * - Index args.
     */
    args: ChangeTableAddIndexArgsType | undefined;
};
export type ChangeTableRemoveIndexOperationType = {
    /**
     * - Operation type.
     */
    type: "removeIndex";
    /**
     * - Index name or columns.
     */
    nameOrColumns: string | Array<string | import("../table-data/table-column.js").default>;
    /**
     * - Index args.
     */
    args: ChangeTableRemoveIndexArgsType | undefined;
};
export type ChangeTableAddReferenceOperationType = {
    /**
     * - Operation type.
     */
    type: "addReference";
    /**
     * - Reference name.
     */
    referenceName: string;
    /**
     * - Reference args.
     */
    args: object | undefined;
};
export type ChangeTableRemoveReferenceOperationType = {
    /**
     * - Operation type.
     */
    type: "removeReference";
    /**
     * - Reference name.
     */
    referenceName: string;
    /**
     * - Reference args.
     */
    args: ChangeTableRemoveReferenceArgsType | undefined;
};
export type ChangeTableRenameColumnOperationType = {
    /**
     * - Operation type.
     */
    type: "renameColumn";
    /**
     * - Previous column name.
     */
    oldColumnName: string;
    /**
     * - New column name.
     */
    newColumnName: string;
};
export type ChangeTableChangeColumnNullOperationType = {
    /**
     * - Operation type.
     */
    type: "changeColumnNull";
    /**
     * - Column name.
     */
    columnName: string;
    /**
     * - Whether the column becomes nullable.
     */
    nullable: boolean;
};
export type ChangeTableOperationType = ChangeTableAddColumnOperationType | ChangeTableRemoveColumnOperationType | ChangeTableAddIndexOperationType | ChangeTableRemoveIndexOperationType | ChangeTableAddReferenceOperationType | ChangeTableRemoveReferenceOperationType | ChangeTableRenameColumnOperationType | ChangeTableChangeColumnNullOperationType;
/**
 * ChangeTableAddIndexArgsType type.
 * @typedef {object} ChangeTableAddIndexArgsType
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should be unique.
 */
/**
 * ChangeTableRemoveIndexArgsType type.
 * @typedef {object} ChangeTableRemoveIndexArgsType
 * @property {string} [name] - Explicit index name to remove.
 */
/**
 * ChangeTableRemoveReferenceArgsType type.
 * @typedef {object} ChangeTableRemoveReferenceArgsType
 * @property {string} [columnName] - Override the derived reference column name.
 * @property {string} [indexName] - Explicit generated index name to remove.
 */
/**
 * ChangeTableAddColumnOperationType type.
 * @typedef {object} ChangeTableAddColumnOperationType
 * @property {"addColumn"} type - Operation type.
 * @property {string} columnName - Column name.
 * @property {string} columnType - Column type.
 * @property {import("../table-data/table-column.js").TableColumnArgsType | undefined} args - Column args.
 */
/**
 * ChangeTableRemoveColumnOperationType type.
 * @typedef {object} ChangeTableRemoveColumnOperationType
 * @property {"removeColumn"} type - Operation type.
 * @property {string} columnName - Column name.
 */
/**
 * ChangeTableAddIndexOperationType type.
 * @typedef {object} ChangeTableAddIndexOperationType
 * @property {"addIndex"} type - Operation type.
 * @property {Array<string | import("../table-data/table-column.js").default>} columns - Columns to index.
 * @property {ChangeTableAddIndexArgsType | undefined} args - Index args.
 */
/**
 * ChangeTableRemoveIndexOperationType type.
 * @typedef {object} ChangeTableRemoveIndexOperationType
 * @property {"removeIndex"} type - Operation type.
 * @property {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
 * @property {ChangeTableRemoveIndexArgsType | undefined} args - Index args.
 */
/**
 * ChangeTableAddReferenceOperationType type.
 * @typedef {object} ChangeTableAddReferenceOperationType
 * @property {"addReference"} type - Operation type.
 * @property {string} referenceName - Reference name.
 * @property {object | undefined} args - Reference args.
 */
/**
 * ChangeTableRemoveReferenceOperationType type.
 * @typedef {object} ChangeTableRemoveReferenceOperationType
 * @property {"removeReference"} type - Operation type.
 * @property {string} referenceName - Reference name.
 * @property {ChangeTableRemoveReferenceArgsType | undefined} args - Reference args.
 */
/**
 * ChangeTableRenameColumnOperationType type.
 * @typedef {object} ChangeTableRenameColumnOperationType
 * @property {"renameColumn"} type - Operation type.
 * @property {string} oldColumnName - Previous column name.
 * @property {string} newColumnName - New column name.
 */
/**
 * ChangeTableChangeColumnNullOperationType type.
 * @typedef {object} ChangeTableChangeColumnNullOperationType
 * @property {"changeColumnNull"} type - Operation type.
 * @property {string} columnName - Column name.
 * @property {boolean} nullable - Whether the column becomes nullable.
 */
/**
 * ChangeTableOperationType type.
 * @typedef {ChangeTableAddColumnOperationType | ChangeTableRemoveColumnOperationType | ChangeTableAddIndexOperationType | ChangeTableRemoveIndexOperationType | ChangeTableAddReferenceOperationType | ChangeTableRemoveReferenceOperationType | ChangeTableRenameColumnOperationType | ChangeTableChangeColumnNullOperationType} ChangeTableOperationType
 */
/**
 * Table-scoped recorder used by `migration.changeTable`. Each call records a
 * single DDL operation synchronously; `changeTable` replays them after the
 * callback completes so a failed callback executes zero recorded DDL.
 */
export default class VelociousDatabaseMigrationChangeTable {
    _tableName: string;
    /**
     * Operations.
     * @type {ChangeTableOperationType[]} */
    _operations: ChangeTableOperationType[];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.tableName - Table name.
     */
    constructor({ tableName }: {
        tableName: string;
    });
    /**
     * Runs get table name.
     * @returns {string} - The table name.
     */
    getTableName(): string;
    /**
     * Runs get operations.
     * @returns {ChangeTableOperationType[]} - The recorded operations.
     */
    getOperations(): ChangeTableOperationType[];
    /**
     * Records a new column.
     * @param {string} name - Column name.
     * @param {string} type - Column type.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    column(name: string, type: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a bigint column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    bigint(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a blob column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    blob(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a boolean column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    boolean(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a datetime column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    datetime(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a decimal column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    decimal(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records an integer column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    integer(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a json column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    json(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a string column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    string(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a text column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    text(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a tinyint column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    tinyint(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a uuid column.
     * @param {string} name - Column name.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    uuid(name: string, args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records created_at and updated_at datetime columns.
     * @param {import("../table-data/table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    timestamps(args?: import("../table-data/table-column.js").TableColumnArgsType): void;
    /**
     * Records a new index.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} columns - Column name or array of column names.
     * @param {ChangeTableAddIndexArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    index(columns: string | Array<string | import("../table-data/table-column.js").default>, args?: ChangeTableAddIndexArgsType): void;
    /**
     * Records a reference column, index, and optional foreign key.
     * @param {string} name - Reference name.
     * @param {object} [args] - Options object.
     * @returns {void} - No return value.
     */
    references(name: string, args?: object): void;
    /**
     * Alias for {@link references}.
     * @param {string} name - Reference name.
     * @param {object} [args] - Options object.
     * @returns {void} - No return value.
     */
    belongsTo(name: string, args?: object): void;
    /**
     * Records removal of one or more columns.
     * @param {string[]} columnNames - Column names to remove.
     * @returns {void} - No return value.
     */
    remove(...columnNames: string[]): void;
    /**
     * Records removal of an index.
     * @param {string | Array<string | import("../table-data/table-column.js").default>} nameOrColumns - Index name or columns.
     * @param {ChangeTableRemoveIndexArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    removeIndex(nameOrColumns: string | Array<string | import("../table-data/table-column.js").default>, args?: ChangeTableRemoveIndexArgsType): void;
    /**
     * Records removal of a reference column and its generated index and foreign keys.
     * @param {string} name - Reference name.
     * @param {ChangeTableRemoveReferenceArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    removeReferences(name: string, args?: ChangeTableRemoveReferenceArgsType): void;
    /**
     * Records removal of the created_at and updated_at columns.
     * @returns {void} - No return value.
     */
    removeTimestamps(): void;
    /**
     * Records a column rename.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {void} - No return value.
     */
    rename(oldColumnName: string, newColumnName: string): void;
    /**
     * Records a change to a column's nullability.
     * @param {string} columnName - Column name.
     * @param {boolean} nullable - Whether the column becomes nullable.
     * @returns {void} - No return value.
     */
    changeNull(columnName: string, nullable: boolean): void;
}
//# sourceMappingURL=change-table.d.ts.map