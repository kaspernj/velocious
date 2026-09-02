export type IndexArgType = {
    unique: boolean;
};
export type TableColumnArgsType = {
    /**
     * - Whether the column auto-increments.
     */
    autoIncrement?: boolean;
    /**
     * - Default value for the column.
     */
    default?: ReturnType<typeof JSON.parse>;
    /**
     * - Whether the column should be dropped.
     */
    dropColumn?: boolean;
    /**
     * - Foreign key options or flag.
     */
    foreignKey?: boolean | object;
    /**
     * - Whether the column should be indexed.
     */
    index?: boolean | IndexArgType;
    /**
     * - Whether this column is being added in a migration.
     */
    isNewColumn?: boolean;
    /**
     * - Alias for maxLength (varchar length limit).
     */
    limit?: number;
    /**
     * - Maximum length for the column value.
     */
    maxLength?: number;
    /**
     * - Column notes or comment.
     */
    notes?: string;
    /**
     * - Whether the column allows null values.
     */
    null?: boolean;
    /**
     * - Whether the column is polymorphic.
     */
    polymorphic?: boolean;
    /**
     * - Numeric precision (total digits) for decimal/numeric types.
     */
    precision?: number;
    /**
     * - Whether the column is a primary key.
     */
    primaryKey?: boolean;
    /**
     * - Numeric scale (digits after decimal point) for decimal/numeric types.
     */
    scale?: number;
    /**
     * - Column data type.
     */
    type?: string;
};
/**
 * TableColumnArgsType type.
 * @typedef {object} TableColumnArgsType
 * @property {boolean} [autoIncrement] - Whether the column auto-increments.
 * @property {ReturnType<typeof JSON.parse>} [default] - Default value for the column.
 * @property {boolean} [dropColumn] - Whether the column should be dropped.
 * @property {boolean|object} [foreignKey] - Foreign key options or flag.
 * @property {boolean|IndexArgType} [index] - Whether the column should be indexed.
 * @property {boolean} [isNewColumn] - Whether this column is being added in a migration.
 * @property {number} [limit] - Alias for maxLength (varchar length limit).
 * @property {number} [maxLength] - Maximum length for the column value.
 * @property {string} [notes] - Column notes or comment.
 * @property {boolean} [null] - Whether the column allows null values.
 * @property {boolean} [polymorphic] - Whether the column is polymorphic.
 * @property {number} [precision] - Numeric precision (total digits) for decimal/numeric types.
 * @property {boolean} [primaryKey] - Whether the column is a primary key.
 * @property {number} [scale] - Numeric scale (digits after decimal point) for decimal/numeric types.
 * @property {string} [type] - Column data type.
 */
export default class TableColumn {
    args: TableColumnArgsType;
    name: string;
    _newName: string | undefined;
    /**
     * Runs constructor.
     * @param {string} name - Name.
     * @param {TableColumnArgsType} [args] - Options object.
     */
    constructor(name: string, args?: TableColumnArgsType);
    /**
     * Runs get name.
     * @returns {string} name
     */
    getName(): string;
    /**
     * Runs get new name.
     * @returns {string | undefined} - The new name.
     */
    getNewName(): string | undefined;
    /**
     * Runs set new name.
     * @param {string} newName - New name.
     * @returns {void} - No return value.
     */
    setNewName(newName: string): void;
    /**
     * Runs get actual name.
     * @returns {string} - The actual name.
     */
    getActualName(): string;
    /**
     * Runs get auto increment.
     * @returns {boolean} - Whether auto increment.
     */
    getAutoIncrement(): boolean;
    /**
     * Runs set auto increment.
     * @param {boolean} newAutoIncrement - New auto increment.
     * @returns {void} - No return value.
     */
    setAutoIncrement(newAutoIncrement: boolean): void;
    /**
     * Runs get default.
     * @returns {ReturnType<typeof JSON.parse> | (() => ReturnType<typeof JSON.parse>)} - The default value or factory.
     */
    getDefault(): ReturnType<typeof JSON.parse> | (() => ReturnType<typeof JSON.parse>);
    /**
     * Runs set default.
     * @param {ReturnType<typeof JSON.parse>} newDefault - New default.
     * @returns {void} - No return value.
     */
    setDefault(newDefault: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs get drop column.
     * @returns {boolean} - Whether drop column.
     */
    getDropColumn(): boolean;
    /**
     * Runs get foreign key.
     * @returns {boolean | object | undefined} - Whether foreign key.
     */
    getForeignKey(): boolean | object | undefined;
    /**
     * Runs set foreign key.
     * @param {boolean | object | undefined} newForeignKey - New foreign key.
     * @returns {void} - No return value.
     */
    setForeignKey(newForeignKey: boolean | object | undefined): void;
    /**
     * Runs get index.
     * @returns {boolean|IndexArgType} - Whether index.
     */
    getIndex(): boolean | IndexArgType;
    /**
     * Runs get index args.
     * @returns {IndexArgType} - The index args.
     */
    getIndexArgs(): IndexArgType;
    getIndexUnique(): boolean;
    /**
     * Runs set index.
     * @param {boolean|IndexArgType} newIndex - New index.
     * @returns {void} - No return value.
     */
    setIndex(newIndex: boolean | IndexArgType): void;
    /**
     * Runs get max length.
     * @returns {number | undefined} - The max length.
     */
    getMaxLength(): number | undefined;
    /**
     * Runs set max length.
     * @param {number | undefined} newMaxLength - New max length.
     * @returns {void} - No return value.
     */
    setMaxLength(newMaxLength: number | undefined): void;
    /**
     * Runs get notes.
     * @returns {string | undefined} - The notes.
     */
    getNotes(): string | undefined;
    /**
     * Runs set notes.
     * @param {string | undefined} newNotes - New notes.
     * @returns {void} - No return value.
     */
    setNotes(newNotes: string | undefined): void;
    /**
     * Runs get null.
     * @returns {boolean | undefined} - Whether null.
     */
    getNull(): boolean | undefined;
    /**
     * Runs set null.
     * @param {boolean} nullable - Whether nullable.
     * @returns {void} - No return value.
     */
    setNull(nullable: boolean): void;
    /**
     * Runs get precision.
     * @returns {number | undefined} - Numeric precision (total digits).
     */
    getPrecision(): number | undefined;
    /**
     * Runs get primary key.
     * @returns {boolean} - Whether primary key.
     */
    getPrimaryKey(): boolean;
    /**
     * Runs set primary key.
     * @param {boolean} newPrimaryKey - New primary key.
     * @returns {void} - No return value.
     */
    setPrimaryKey(newPrimaryKey: boolean): void;
    /**
     * Runs get scale.
     * @returns {number | undefined} - Numeric scale (digits after decimal point).
     */
    getScale(): number | undefined;
    /**
     * Runs get type.
     * @returns {string | undefined} - The type.
     */
    getType(): string | undefined;
    /**
     * Runs set type.
     * @param {string | undefined} newType - New type.
     * @returns {void} - No return value.
     */
    setType(newType: string | undefined): void;
    /**
     * Runs get type hint notes.
     * @returns {string | undefined} - The type hint notes.
     */
    getTypeHintNotes(): string | undefined;
    /**
     * Runs get notes for database.
     * @param {string} databaseType - Database type.
     * @returns {string | undefined} - Notes for the database.
     */
    getNotesForDatabase(databaseType: string): string | undefined;
    /**
     * Runs is new column.
     * @returns {boolean} - Whether new column.
     */
    isNewColumn(): boolean;
    /**
     * Runs get sql.
     * @param {object} args - Options object.
     * @param {boolean} args.forAlterTable - Whether for alter table.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {boolean} [args.skipForeignKey] - Skip emitting the inline REFERENCES clause (the caller emits a table-level FOREIGN KEY constraint instead).
     * @returns {string} - SQL string.
     */
    getSQL({ forAlterTable, driver, skipForeignKey, ...restArgs }: {
        forAlterTable: boolean;
        driver: import("../drivers/base.js").default;
        skipForeignKey?: boolean;
    }): string;
}
//# sourceMappingURL=table-column.d.ts.map