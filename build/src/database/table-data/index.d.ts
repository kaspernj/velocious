import TableColumn from "./table-column.js";
import TableIndex from "./table-index.js";
import TableReference from "./table-reference.js";
export type TableDataArgsType = {
    /**
     * - Whether to create the table only if it does not exist.
     */
    ifNotExists: boolean;
    /**
     * - Default type for implicit primary-key references.
     */
    primaryKeyType?: string;
};
/**
 * TableDataArgsType type.
 * @typedef {object} TableDataArgsType
 * @property {boolean} ifNotExists - Whether to create the table only if it does not exist.
 * @property {string} [primaryKeyType] - Default type for implicit primary-key references.
 */
export default class TableData {
    args: TableDataArgsType | undefined;
    _name: string;
    /**
     * Columns.
     * @type {TableColumn[]} */
    _columns: TableColumn[];
    /**
     * Foreign keys.
     * @type {import("./table-foreign-key.js").default[]} */
    _foreignKeys: import("./table-foreign-key.js").default[];
    /**
     * Indexes.
     * @type {TableIndex[]} */
    _indexes: TableIndex[];
    /**
     * References.
     * @type {TableReference[]} */
    _references: TableReference[];
    /**
     * Runs constructor.
     * @param {string} name - Name.
     * @param {TableDataArgsType} [args] - Options object.
     */
    constructor(name: string, args?: TableDataArgsType);
    /**
     * Runs add column.
     * @param {string|TableColumn} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     */
    addColumn(name: string | TableColumn, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs get columns.
     * @returns {TableColumn[]} - The columns.
     */
    getColumns(): TableColumn[];
    /**
     * Runs add foreign key.
     * @param {import("./table-foreign-key.js").default} foreignKey - Foreign key.
     */
    addForeignKey(foreignKey: import("./table-foreign-key.js").default): void;
    /**
     * Runs get foreign keys.
     * @returns {import("./table-foreign-key.js").default[]} - The foreign keys.
     */
    getForeignKeys(): import("./table-foreign-key.js").default[];
    /**
     * Runs add index.
     * @param {TableIndex} index - Index value.
     */
    addIndex(index: TableIndex): void;
    /**
     * Runs get indexes.
     * @returns {TableIndex[]} - The indexes.
     */
    getIndexes(): TableIndex[];
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
    /**
     * Runs get if not exists.
     * @returns {boolean} - Whether if not exists.
     */
    getIfNotExists(): boolean;
    /**
     * Runs get references.
     * @returns {TableReference[]} - The references.
     */
    getReferences(): TableReference[];
    /**
     * Runs bigint.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    bigint(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs blob.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    blob(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs boolean.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    boolean(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs datetime.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    datetime(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs decimal.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    decimal(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs integer.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    integer(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs json.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    json(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs tinyint.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    tinyint(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs references.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    references(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs string.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    string(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs text.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    text(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs timestamps.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    timestamps(args?: import("./table-column.js").TableColumnArgsType): void;
    /**
     * Runs uuid.
     * @param {string} name - Name.
     * @param {import("./table-column.js").TableColumnArgsType} [args] - Options object.
     * @returns {void} - No return value.
     */
    uuid(name: string, args?: import("./table-column.js").TableColumnArgsType): void;
}
//# sourceMappingURL=index.d.ts.map