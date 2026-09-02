// @ts-check
/**
 * Defines this typedef.
 * @typedef {{unique: boolean}} IndexArgType
 */
import * as inflection from "inflection";
import restArgsError from "../../utils/rest-args-error.js";
import TableForeignKey from "./table-foreign-key.js";
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
    /**
     * Runs constructor.
     * @param {string} name - Name.
     * @param {TableColumnArgsType} [args] - Options object.
     */
    constructor(name, args) {
        if (args) {
            const { autoIncrement, default: columnDefault, dropColumn, foreignKey, index, isNewColumn, limit, maxLength, notes, null: argsNull, polymorphic, precision, primaryKey, scale, type, ...restArgs } = args; // eslint-disable-line no-unused-vars
            if (Object.keys(args).length == 0) {
                throw new Error("Empty args given");
            }
            restArgsError(restArgs);
            // Normalize limit → maxLength for string-like types only.
            if (limit !== undefined && maxLength === undefined) {
                const normalizedType = typeof type === "string" ? type.toLowerCase() : "";
                if (normalizedType === "string" || normalizedType === "text" || normalizedType === "varchar" || normalizedType === "nvarchar" || normalizedType === "char") {
                    args.maxLength = limit;
                }
            }
        }
        this.args = args || {};
        this.name = name;
    }
    /**
     * Runs get name.
     * @returns {string} name
     */
    getName() { return this.name; }
    /**
     * Runs get new name.
     * @returns {string | undefined} - The new name.
     */
    getNewName() { return this._newName; }
    /**
     * Runs set new name.
     * @param {string} newName - New name.
     * @returns {void} - No return value.
     */
    setNewName(newName) { this._newName = newName; }
    /**
     * Runs get actual name.
     * @returns {string} - The actual name.
     */
    getActualName() { return this.getNewName() || this.getName(); }
    /**
     * Runs get auto increment.
     * @returns {boolean} - Whether auto increment.
     */
    getAutoIncrement() { return this.args?.autoIncrement || false; }
    /**
     * Runs set auto increment.
     * @param {boolean} newAutoIncrement - New auto increment.
     * @returns {void} - No return value.
     */
    setAutoIncrement(newAutoIncrement) { this.args.autoIncrement = newAutoIncrement; }
    /**
     * Runs get default.
     * @returns {ReturnType<typeof JSON.parse> | (() => ReturnType<typeof JSON.parse>)} - The default value or factory.
     */
    getDefault() { return this.args?.default; }
    /**
     * Runs set default.
     * @param {ReturnType<typeof JSON.parse>} newDefault - New default.
     * @returns {void} - No return value.
     */
    setDefault(newDefault) { this.args.default = newDefault; }
    /**
     * Runs get drop column.
     * @returns {boolean} - Whether drop column.
     */
    getDropColumn() { return this.args?.dropColumn || false; }
    /**
     * Runs get foreign key.
     * @returns {boolean | object | undefined} - Whether foreign key.
     */
    getForeignKey() { return this.args?.foreignKey; }
    /**
     * Runs set foreign key.
     * @param {boolean | object | undefined} newForeignKey - New foreign key.
     * @returns {void} - No return value.
     */
    setForeignKey(newForeignKey) { this.args.foreignKey = newForeignKey; }
    /**
     * Runs get index.
     * @returns {boolean|IndexArgType} - Whether index.
     */
    getIndex() { return this.args?.index || false; }
    /**
     * Runs get index args.
     * @returns {IndexArgType} - The index args.
     */
    getIndexArgs() {
        if (typeof this.args?.index == "object") {
            return this.args.index;
        }
        else {
            return { unique: false };
        }
    }
    getIndexUnique() {
        const index = this.args?.index;
        if (typeof index == "object" && index.unique === true)
            return true;
        return false;
    }
    /**
     * Runs set index.
     * @param {boolean|IndexArgType} newIndex - New index.
     * @returns {void} - No return value.
     */
    setIndex(newIndex) { this.args.index = newIndex; }
    /**
     * Runs get max length.
     * @returns {number | undefined} - The max length.
     */
    getMaxLength() { return this.args?.maxLength; }
    /**
     * Runs set max length.
     * @param {number | undefined} newMaxLength - New max length.
     * @returns {void} - No return value.
     */
    setMaxLength(newMaxLength) { this.args.maxLength = newMaxLength; }
    /**
     * Runs get notes.
     * @returns {string | undefined} - The notes.
     */
    getNotes() { return this.args?.notes; }
    /**
     * Runs set notes.
     * @param {string | undefined} newNotes - New notes.
     * @returns {void} - No return value.
     */
    setNotes(newNotes) { this.args.notes = newNotes; }
    /**
     * Runs get null.
     * @returns {boolean | undefined} - Whether null.
     */
    getNull() { return this.args?.null; }
    /**
     * Runs set null.
     * @param {boolean} nullable - Whether nullable.
     * @returns {void} - No return value.
     */
    setNull(nullable) { this.args.null = nullable; }
    /**
     * Runs get precision.
     * @returns {number | undefined} - Numeric precision (total digits).
     */
    getPrecision() { return this.args?.precision; }
    /**
     * Runs get primary key.
     * @returns {boolean} - Whether primary key.
     */
    getPrimaryKey() { return this.args?.primaryKey || false; }
    /**
     * Runs set primary key.
     * @param {boolean} newPrimaryKey - New primary key.
     * @returns {void} - No return value.
     */
    setPrimaryKey(newPrimaryKey) { this.args.primaryKey = newPrimaryKey; }
    /**
     * Runs get scale.
     * @returns {number | undefined} - Numeric scale (digits after decimal point).
     */
    getScale() { return this.args?.scale; }
    /**
     * Runs get type.
     * @returns {string | undefined} - The type.
     */
    getType() { return this.args?.type; }
    /**
     * Runs set type.
     * @param {string | undefined} newType - New type.
     * @returns {void} - No return value.
     */
    setType(newType) { this.args.type = newType; }
    /**
     * Runs get type hint notes.
     * @returns {string | undefined} - The type hint notes.
     */
    getTypeHintNotes() {
        if (this.getType()?.toLowerCase() == "boolean")
            return "velocious:type=boolean";
    }
    /**
     * Runs get notes for database.
     * @param {string} databaseType - Database type.
     * @returns {string | undefined} - Notes for the database.
     */
    getNotesForDatabase(databaseType) {
        if (!["mysql", "pgsql"].includes(databaseType))
            return;
        return this.getNotes() || this.getTypeHintNotes();
    }
    /**
     * Runs is new column.
     * @returns {boolean} - Whether new column.
     */
    isNewColumn() { return this.args?.isNewColumn || false; }
    /**
     * Runs get sql.
     * @param {object} args - Options object.
     * @param {boolean} args.forAlterTable - Whether for alter table.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {boolean} [args.skipForeignKey] - Skip emitting the inline REFERENCES clause (the caller emits a table-level FOREIGN KEY constraint instead).
     * @returns {string} - SQL string.
     */
    getSQL({ forAlterTable, driver, skipForeignKey, ...restArgs }) {
        restArgsError(restArgs);
        const databaseType = driver.getType();
        const options = driver.options();
        let maxlength = this.getMaxLength();
        let type = this.getType()?.toUpperCase();
        if (databaseType == "pgsql") {
            if (type == "DATETIME") {
                type = "TIMESTAMP";
            }
            else if (type == "TINYINT") {
                type = "SMALLINT";
            }
            else if (type == "BLOB") {
                type = "BYTEA";
                maxlength = undefined;
            }
        }
        if (type == "STRING") {
            type = databaseType == "mssql" ? "NVARCHAR" : "VARCHAR";
            maxlength ||= 255;
        }
        if (databaseType == "mysql" && type == "BOOLEAN") {
            type = "TINYINT";
            maxlength = 1;
        }
        if (databaseType == "pgsql" && type == "TINYINT") {
            type = "SMALLINT";
        }
        if (databaseType == "mssql") {
            if (type == "BOOLEAN") {
                type = "BIT";
            }
            else if (type == "UUID") {
                type = "VARCHAR";
                maxlength ||= 36;
            }
            else if (type == "JSON") {
                type = "NVARCHAR(MAX)";
                maxlength = undefined;
            }
            else if (type == "BLOB") {
                type = "VARBINARY(MAX)";
                maxlength = undefined;
            }
            else if (type == "TEXT") {
                type = "NVARCHAR(MAX)";
                maxlength = undefined;
            }
        }
        if (databaseType == "sqlite" && this.getAutoIncrement() && this.getPrimaryKey()) {
            type = "INTEGER";
        }
        if (databaseType == "pgsql" && this.getAutoIncrement() && this.getPrimaryKey()) {
            if (type == "BIGINT") {
                type = "BIGSERIAL";
            }
            else if (type == "SMALLINT") {
                type = "SMALLSERIAL";
            }
            else {
                type = "SERIAL";
            }
        }
        let sql = `${options.quoteColumnName(this.getActualName())} `;
        if (databaseType == "pgsql" && forAlterTable)
            sql += "TYPE ";
        if (type)
            sql += type;
        const precision = this.getPrecision();
        const scale = this.getScale();
        if ((scale !== undefined && scale !== null) && (precision === undefined || precision === null)) {
            throw new Error(`Column '${this.getActualName()}': scale requires precision to be set`);
        }
        if (precision !== undefined && precision !== null) {
            sql += scale !== undefined && scale !== null ? `(${precision}, ${scale})` : `(${precision})`;
        }
        else if (databaseType == "mysql" && type == "DATETIME") {
            sql += "(3)";
        }
        else if (type && maxlength !== undefined && maxlength !== null) {
            sql += `(${maxlength})`;
        }
        if (this.getAutoIncrement() && driver.shouldSetAutoIncrementWhenPrimaryKey()) {
            if (databaseType == "mssql") {
                sql += " IDENTITY";
            }
            else if (databaseType == "pgsql") {
                if (this.getAutoIncrement() && this.getPrimaryKey()) {
                    // Do nothing
                }
                else {
                    throw new Error("pgsql auto increment must be primary key");
                }
            }
            else {
                sql += " AUTO_INCREMENT";
            }
        }
        const defaultValue = this.getDefault();
        if (typeof defaultValue == "function") {
            const evaluatedDefault = defaultValue();
            sql += ` DEFAULT (`;
            if (databaseType == "pgsql" && evaluatedDefault == "UUID()") {
                sql += "gen_random_uuid()";
            }
            else if (databaseType == "mssql" && evaluatedDefault == "UUID()") {
                sql += "NEWID()";
            }
            else {
                sql += evaluatedDefault;
            }
            sql += ")";
        }
        else if (defaultValue !== undefined && defaultValue !== null) {
            // Emit falsy defaults too (`0`, `false`, `""`). A truthiness check here
            // silently dropped `default: 0`, leaving the column NOT NULL with no
            // default so inserts that omit it fail in strict mode.
            sql += ` DEFAULT ${options.quote(defaultValue)}`;
        }
        if (this.getPrimaryKey())
            sql += " PRIMARY KEY";
        if (this.getNull() === false)
            sql += " NOT NULL";
        const notes = this.getNotesForDatabase(databaseType);
        if (notes && databaseType == "mysql") {
            sql += ` COMMENT ${options.quote(notes)}`;
        }
        const foreignKey = skipForeignKey ? undefined : this.getForeignKey();
        if (foreignKey) {
            let foreignKeyTable, foreignKeyColumn;
            if (foreignKey === true) {
                foreignKeyColumn = "id";
                foreignKeyTable = inflection.pluralize(this.getActualName().replace(/_id$/, ""));
            }
            else if (foreignKey instanceof TableForeignKey) {
                foreignKeyColumn = foreignKey.getReferencedColumnName();
                foreignKeyTable = foreignKey.getReferencedTableName();
            }
            else {
                throw new Error(`Unknown foreign key type given: ${foreignKey} (${typeof foreignKey})`);
            }
            sql += ` REFERENCES ${options.quoteTableName(foreignKeyTable)}(${options.quoteColumnName(foreignKeyColumn)})`;
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFibGUtY29sdW1uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSCxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGFBQWEsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUMxRCxPQUFPLGVBQWUsTUFBTSx3QkFBd0IsQ0FBQTtBQUVwRDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBRUgsTUFBTSxDQUFDLE9BQU8sT0FBTyxXQUFXO0lBQzlCOzs7O09BSUc7SUFDSCxZQUFZLElBQUksRUFBRSxJQUFJO1FBQ3BCLElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCxNQUFNLEVBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQyxHQUFHLElBQUksQ0FBQSxDQUFDLHFDQUFxQztZQUU3TyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFDckMsQ0FBQztZQUVELGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUV2QiwwREFBMEQ7WUFDMUQsSUFBSSxLQUFLLEtBQUssU0FBUyxJQUFJLFNBQVMsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDbkQsTUFBTSxjQUFjLEdBQUcsT0FBTyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxJ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QUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUVwRSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2YsSUFBSSxlQUFlLEVBQUUsZ0JBQWdCLENBQUE7WUFFckMsSUFBSSxVQUFVLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQ3hCLGdCQUFnQixHQUFHLElBQUksQ0FBQTtnQkFDdkIsZUFBZSxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUNsRixDQUFDO2lCQUFNLElBQUksVUFBVSxZQUFZLGVBQWUsRUFBRSxDQUFDO2dCQUNqRCxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtnQkFDdkQsZUFBZSxHQUFHLFVBQVUsQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1lBQ3ZELENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxVQUFVLEtBQUssT0FBTyxVQUFVLEdBQUcsQ0FBQyxDQUFBO1lBQ3pGLENBQUM7WUFFRCxHQUFHLElBQUksZUFBZSxPQUFPLENBQUMsY0FBYyxDQUFDLGVBQWUsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFBO1FBQy9HLENBQUM7UUFFRCxPQUFPLEdBQUcsQ0FBQTtJQUNaLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t1bmlxdWU6IGJvb2xlYW59fSBJbmRleEFyZ1R5cGVcbiAqL1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IFRhYmxlRm9yZWlnbktleSBmcm9tIFwiLi90YWJsZS1mb3JlaWduLWtleS5qc1wiXG5cbi8qKlxuICogVGFibGVDb2x1bW5BcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGFibGVDb2x1bW5BcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbYXV0b0luY3JlbWVudF0gLSBXaGV0aGVyIHRoZSBjb2x1bW4gYXV0by1pbmNyZW1lbnRzLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2RlZmF1bHRdIC0gRGVmYXVsdCB2YWx1ZSBmb3IgdGhlIGNvbHVtbi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2Ryb3BDb2x1bW5dIC0gV2hldGhlciB0aGUgY29sdW1uIHNob3VsZCBiZSBkcm9wcGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufG9iamVjdH0gW2ZvcmVpZ25LZXldIC0gRm9yZWlnbiBrZXkgb3B0aW9ucyBvciBmbGFnLlxuICogQHByb3BlcnR5IHtib29sZWFufEluZGV4QXJnVHlwZX0gW2luZGV4XSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBzaG91bGQgYmUgaW5kZXhlZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lzTmV3Q29sdW1uXSAtIFdoZXRoZXIgdGhpcyBjb2x1bW4gaXMgYmVpbmcgYWRkZWQgaW4gYSBtaWdyYXRpb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbWl0XSAtIEFsaWFzIGZvciBtYXhMZW5ndGggKHZhcmNoYXIgbGVuZ3RoIGxpbWl0KS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4TGVuZ3RoXSAtIE1heGltdW0gbGVuZ3RoIGZvciB0aGUgY29sdW1uIHZhbHVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtub3Rlc10gLSBDb2x1bW4gbm90ZXMgb3IgY29tbWVudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW251bGxdIC0gV2hldGhlciB0aGUgY29sdW1uIGFsbG93cyBudWxsIHZhbHVlcy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3BvbHltb3JwaGljXSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBwb2x5bW9ycGhpYy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcHJlY2lzaW9uXSAtIE51bWVyaWMgcHJlY2lzaW9uICh0b3RhbCBkaWdpdHMpIGZvciBkZWNpbWFsL251bWVyaWMgdHlwZXMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtwcmltYXJ5S2V5XSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBhIHByaW1hcnkga2V5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtzY2FsZV0gLSBOdW1lcmljIHNjYWxlIChkaWdpdHMgYWZ0ZXIgZGVjaW1hbCBwb2ludCkgZm9yIGRlY2ltYWwvbnVtZXJpYyB0eXBlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBDb2x1bW4gZGF0YSB0eXBlLlxuICovXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRhYmxlQ29sdW1uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtUYWJsZUNvbHVtbkFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG5hbWUsIGFyZ3MpIHtcbiAgICBpZiAoYXJncykge1xuICAgICAgY29uc3Qge2F1dG9JbmNyZW1lbnQsIGRlZmF1bHQ6IGNvbHVtbkRlZmF1bHQsIGRyb3BDb2x1bW4sIGZvcmVpZ25LZXksIGluZGV4LCBpc05ld0NvbHVtbiwgbGltaXQsIG1heExlbmd0aCwgbm90ZXMsIG51bGw6IGFyZ3NOdWxsLCBwb2x5bW9ycGhpYywgcHJlY2lzaW9uLCBwcmltYXJ5S2V5LCBzY2FsZSwgdHlwZSwgLi4ucmVzdEFyZ3N9ID0gYXJncyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFbXB0eSBhcmdzIGdpdmVuXCIpXG4gICAgICB9XG5cbiAgICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICAgIC8vIE5vcm1hbGl6ZSBsaW1pdCDihpIgbWF4TGVuZ3RoIGZvciBzdHJpbmctbGlrZSB0eXBlcyBvbmx5LlxuICAgICAgaWYgKGxpbWl0ICE9PSB1bmRlZmluZWQgJiYgbWF4TGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSB0eXBlb2YgdHlwZSA9PT0gXCJzdHJpbmdcIiA/IHR5cGUudG9Mb3dlckNhc2UoKSA6IFwiXCJcblxuICAgICAgICBpZiAobm9ybWFsaXplZFR5cGUgPT09IFwic3RyaW5nXCIgfHwgbm9ybWFsaXplZFR5cGUgPT09IFwidGV4dFwiIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcInZhcmNoYXJcIiB8fCBub3JtYWxpemVkVHlwZSA9PT0gXCJudmFyY2hhclwiIHx8IG5vcm1hbGl6ZWRUeXBlID09PSBcImNoYXJcIikge1xuICAgICAgICAgIGFyZ3MubWF4TGVuZ3RoID0gbGltaXRcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuYXJncyA9IGFyZ3MgfHwge31cbiAgICB0aGlzLm5hbWUgPSBuYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gbmFtZVxuICAgKi9cbiAgZ2V0TmFtZSgpIHsgcmV0dXJuIHRoaXMubmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5ldyBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBuZXcgbmFtZS5cbiAgICovXG4gIGdldE5ld05hbWUoKSB7IHJldHVybiB0aGlzLl9uZXdOYW1lIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbmV3IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdOYW1lIC0gTmV3IG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE5ld05hbWUobmV3TmFtZSkgeyB0aGlzLl9uZXdOYW1lID0gbmV3TmFtZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFjdHVhbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBhY3R1YWwgbmFtZS5cbiAgICovXG4gIGdldEFjdHVhbE5hbWUoKSB7IHJldHVybiB0aGlzLmdldE5ld05hbWUoKSB8fCB0aGlzLmdldE5hbWUoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG8gaW5jcmVtZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGF1dG8gaW5jcmVtZW50LlxuICAgKi9cbiAgZ2V0QXV0b0luY3JlbWVudCgpIHsgcmV0dXJuIHRoaXMuYXJncz8uYXV0b0luY3JlbWVudCB8fCBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG8gaW5jcmVtZW50LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0F1dG9JbmNyZW1lbnQgLSBOZXcgYXV0byBpbmNyZW1lbnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEF1dG9JbmNyZW1lbnQobmV3QXV0b0luY3JlbWVudCkgeyB0aGlzLmFyZ3MuYXV0b0luY3JlbWVudCA9IG5ld0F1dG9JbmNyZW1lbnQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWZhdWx0LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCAoKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pfSAtIFRoZSBkZWZhdWx0IHZhbHVlIG9yIGZhY3RvcnkuXG4gICAqL1xuICBnZXREZWZhdWx0KCkgeyByZXR1cm4gdGhpcy5hcmdzPy5kZWZhdWx0IH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZGVmYXVsdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3RGVmYXVsdCAtIE5ldyBkZWZhdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXREZWZhdWx0KG5ld0RlZmF1bHQpIHsgdGhpcy5hcmdzLmRlZmF1bHQgPSBuZXdEZWZhdWx0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZHJvcCBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZHJvcCBjb2x1bW4uXG4gICAqL1xuICBnZXREcm9wQ29sdW1uKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5kcm9wQ29sdW1uIHx8IGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZm9yZWlnbiBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgb2JqZWN0IHwgdW5kZWZpbmVkfSAtIFdoZXRoZXIgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBnZXRGb3JlaWduS2V5KCkgeyByZXR1cm4gdGhpcy5hcmdzPy5mb3JlaWduS2V5IH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IG9iamVjdCB8IHVuZGVmaW5lZH0gbmV3Rm9yZWlnbktleSAtIE5ldyBmb3JlaWduIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Rm9yZWlnbktleShuZXdGb3JlaWduS2V5KSB7IHRoaXMuYXJncy5mb3JlaWduS2V5ID0gbmV3Rm9yZWlnbktleSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGluZGV4LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbnxJbmRleEFyZ1R5cGV9IC0gV2hldGhlciBpbmRleC5cbiAgICovXG4gIGdldEluZGV4KCkgeyByZXR1cm4gdGhpcy5hcmdzPy5pbmRleCB8fCBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGluZGV4IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtJbmRleEFyZ1R5cGV9IC0gVGhlIGluZGV4IGFyZ3MuXG4gICAqL1xuICBnZXRJbmRleEFyZ3MoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLmFyZ3M/LmluZGV4ID09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmFyZ3MuaW5kZXhcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHt1bmlxdWU6IGZhbHNlfVxuICAgIH1cbiAgfVxuXG4gIGdldEluZGV4VW5pcXVlKCkge1xuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5hcmdzPy5pbmRleFxuXG4gICAgaWYgKHR5cGVvZiBpbmRleCA9PSBcIm9iamVjdFwiICYmIGluZGV4LnVuaXF1ZSA9PT0gdHJ1ZSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGluZGV4LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW58SW5kZXhBcmdUeXBlfSBuZXdJbmRleCAtIE5ldyBpbmRleC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SW5kZXgobmV3SW5kZXgpIHsgdGhpcy5hcmdzLmluZGV4ID0gbmV3SW5kZXggfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtYXggbGVuZ3RoLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSBtYXggbGVuZ3RoLlxuICAgKi9cbiAgZ2V0TWF4TGVuZ3RoKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5tYXhMZW5ndGggfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBtYXggbGVuZ3RoLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gbmV3TWF4TGVuZ3RoIC0gTmV3IG1heCBsZW5ndGguXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1heExlbmd0aChuZXdNYXhMZW5ndGgpIHsgdGhpcy5hcmdzLm1heExlbmd0aCA9IG5ld01heExlbmd0aCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG5vdGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBub3Rlcy5cbiAgICovXG4gIGdldE5vdGVzKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5ub3RlcyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG5vdGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbmV3Tm90ZXMgLSBOZXcgbm90ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE5vdGVzKG5ld05vdGVzKSB7IHRoaXMuYXJncy5ub3RlcyA9IG5ld05vdGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbnVsbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCB1bmRlZmluZWR9IC0gV2hldGhlciBudWxsLlxuICAgKi9cbiAgZ2V0TnVsbCgpIHsgcmV0dXJuIHRoaXMuYXJncz8ubnVsbCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG51bGwuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbnVsbGFibGUgLSBXaGV0aGVyIG51bGxhYmxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXROdWxsKG51bGxhYmxlKSB7IHRoaXMuYXJncy5udWxsID0gbnVsbGFibGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVjaXNpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gTnVtZXJpYyBwcmVjaXNpb24gKHRvdGFsIGRpZ2l0cykuXG4gICAqL1xuICBnZXRQcmVjaXNpb24oKSB7IHJldHVybiB0aGlzLmFyZ3M/LnByZWNpc2lvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZ2V0UHJpbWFyeUtleSgpIHsgcmV0dXJuIHRoaXMuYXJncz8ucHJpbWFyeUtleSB8fCBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ByaW1hcnlLZXkgLSBOZXcgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFByaW1hcnlLZXkobmV3UHJpbWFyeUtleSkgeyB0aGlzLmFyZ3MucHJpbWFyeUtleSA9IG5ld1ByaW1hcnlLZXkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzY2FsZS5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOdW1lcmljIHNjYWxlIChkaWdpdHMgYWZ0ZXIgZGVjaW1hbCBwb2ludCkuXG4gICAqL1xuICBnZXRTY2FsZSgpIHsgcmV0dXJuIHRoaXMuYXJncz8uc2NhbGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIHRoaXMuYXJncz8udHlwZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBuZXdUeXBlIC0gTmV3IHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFR5cGUobmV3VHlwZSkgeyB0aGlzLmFyZ3MudHlwZSA9IG5ld1R5cGUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlIGhpbnQgbm90ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHR5cGUgaGludCBub3Rlcy5cbiAgICovXG4gIGdldFR5cGVIaW50Tm90ZXMoKSB7XG4gICAgaWYgKHRoaXMuZ2V0VHlwZSgpPy50b0xvd2VyQ2FzZSgpID09IFwiYm9vbGVhblwiKSByZXR1cm4gXCJ2ZWxvY2lvdXM6dHlwZT1ib29sZWFuXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBub3RlcyBmb3IgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZVR5cGUgLSBEYXRhYmFzZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIE5vdGVzIGZvciB0aGUgZGF0YWJhc2UuXG4gICAqL1xuICBnZXROb3Rlc0ZvckRhdGFiYXNlKGRhdGFiYXNlVHlwZSkge1xuICAgIGlmICghW1wibXlzcWxcIiwgXCJwZ3NxbFwiXS5pbmNsdWRlcyhkYXRhYmFzZVR5cGUpKSByZXR1cm5cblxuICAgIHJldHVybiB0aGlzLmdldE5vdGVzKCkgfHwgdGhpcy5nZXRUeXBlSGludE5vdGVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmV3IGNvbHVtbi5cbiAgICovXG4gIGlzTmV3Q29sdW1uKCkgeyByZXR1cm4gdGhpcy5hcmdzPy5pc05ld0NvbHVtbiB8fCBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHNxbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmZvckFsdGVyVGFibGUgLSBXaGV0aGVyIGZvciBhbHRlciB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kcml2ZXIgLSBEYXRhYmFzZSBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3Muc2tpcEZvcmVpZ25LZXldIC0gU2tpcCBlbWl0dGluZyB0aGUgaW5saW5lIFJFRkVSRU5DRVMgY2xhdXNlICh0aGUgY2FsbGVyIGVtaXRzIGEgdGFibGUtbGV2ZWwgRk9SRUlHTiBLRVkgY29uc3RyYWludCBpbnN0ZWFkKS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZ2V0U1FMKHtmb3JBbHRlclRhYmxlLCBkcml2ZXIsIHNraXBGb3JlaWduS2V5LCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgZGF0YWJhc2VUeXBlID0gZHJpdmVyLmdldFR5cGUoKVxuICAgIGNvbnN0IG9wdGlvbnMgPSBkcml2ZXIub3B0aW9ucygpXG4gICAgbGV0IG1heGxlbmd0aCA9IHRoaXMuZ2V0TWF4TGVuZ3RoKClcbiAgICBsZXQgdHlwZSA9IHRoaXMuZ2V0VHlwZSgpPy50b1VwcGVyQ2FzZSgpXG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwicGdzcWxcIikge1xuICAgICAgaWYgKHR5cGUgPT0gXCJEQVRFVElNRVwiKSB7XG4gICAgICAgIHR5cGUgPSBcIlRJTUVTVEFNUFwiXG4gICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJUSU5ZSU5UXCIpIHtcbiAgICAgICAgdHlwZSA9IFwiU01BTExJTlRcIlxuICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiQkxPQlwiKSB7XG4gICAgICAgIHR5cGUgPSBcIkJZVEVBXCJcbiAgICAgICAgbWF4bGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT0gXCJTVFJJTkdcIikge1xuICAgICAgdHlwZSA9IGRhdGFiYXNlVHlwZSA9PSBcIm1zc3FsXCIgPyBcIk5WQVJDSEFSXCIgOiBcIlZBUkNIQVJcIlxuICAgICAgbWF4bGVuZ3RoIHx8PSAyNTVcbiAgICB9XG4gICAgaWYgKGRhdGFiYXNlVHlwZSA9PSBcIm15c3FsXCIgJiYgdHlwZSA9PSBcIkJPT0xFQU5cIikge1xuICAgICAgdHlwZSA9IFwiVElOWUlOVFwiXG4gICAgICBtYXhsZW5ndGggPSAxXG4gICAgfVxuICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJwZ3NxbFwiICYmIHR5cGUgPT0gXCJUSU5ZSU5UXCIpIHtcbiAgICAgIHR5cGUgPSBcIlNNQUxMSU5UXCJcbiAgICB9XG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwibXNzcWxcIikge1xuICAgICAgaWYgKHR5cGUgPT0gXCJCT09MRUFOXCIpIHtcbiAgICAgICAgdHlwZSA9IFwiQklUXCJcbiAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcIlVVSURcIikge1xuICAgICAgICB0eXBlID0gXCJWQVJDSEFSXCJcbiAgICAgICAgbWF4bGVuZ3RoIHx8PSAzNlxuICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiSlNPTlwiKSB7XG4gICAgICAgIHR5cGUgPSBcIk5WQVJDSEFSKE1BWClcIlxuICAgICAgICBtYXhsZW5ndGggPSB1bmRlZmluZWRcbiAgICAgIH0gZWxzZSBpZiAodHlwZSA9PSBcIkJMT0JcIikge1xuICAgICAgICB0eXBlID0gXCJWQVJCSU5BUlkoTUFYKVwiXG4gICAgICAgIG1heGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgICAgfSBlbHNlIGlmICh0eXBlID09IFwiVEVYVFwiKSB7XG4gICAgICAgIHR5cGUgPSBcIk5WQVJDSEFSKE1BWClcIlxuICAgICAgICBtYXhsZW5ndGggPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwic3FsaXRlXCIgJiYgdGhpcy5nZXRBdXRvSW5jcmVtZW50KCkgJiYgdGhpcy5nZXRQcmltYXJ5S2V5KCkpIHtcbiAgICAgIHR5cGUgPSBcIklOVEVHRVJcIlxuICAgIH1cblxuICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJwZ3NxbFwiICYmIHRoaXMuZ2V0QXV0b0luY3JlbWVudCgpICYmIHRoaXMuZ2V0UHJpbWFyeUtleSgpKSB7XG4gICAgICBpZiAodHlwZSA9PSBcIkJJR0lOVFwiKSB7XG4gICAgICAgIHR5cGUgPSBcIkJJR1NFUklBTFwiXG4gICAgICB9IGVsc2UgaWYgKHR5cGUgPT0gXCJTTUFMTElOVFwiKSB7XG4gICAgICAgIHR5cGUgPSBcIlNNQUxMU0VSSUFMXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHR5cGUgPSBcIlNFUklBTFwiXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHNxbCA9IGAke29wdGlvbnMucXVvdGVDb2x1bW5OYW1lKHRoaXMuZ2V0QWN0dWFsTmFtZSgpKX0gYFxuXG4gICAgaWYgKGRhdGFiYXNlVHlwZSA9PSBcInBnc3FsXCIgJiYgZm9yQWx0ZXJUYWJsZSkgc3FsICs9IFwiVFlQRSBcIlxuICAgIGlmICh0eXBlKSBzcWwgKz0gdHlwZVxuXG4gICAgY29uc3QgcHJlY2lzaW9uID0gdGhpcy5nZXRQcmVjaXNpb24oKVxuICAgIGNvbnN0IHNjYWxlID0gdGhpcy5nZXRTY2FsZSgpXG5cbiAgICBpZiAoKHNjYWxlICE9PSB1bmRlZmluZWQgJiYgc2NhbGUgIT09IG51bGwpICYmIChwcmVjaXNpb24gPT09IHVuZGVmaW5lZCB8fCBwcmVjaXNpb24gPT09IG51bGwpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbHVtbiAnJHt0aGlzLmdldEFjdHVhbE5hbWUoKX0nOiBzY2FsZSByZXF1aXJlcyBwcmVjaXNpb24gdG8gYmUgc2V0YClcbiAgICB9XG5cbiAgICBpZiAocHJlY2lzaW9uICE9PSB1bmRlZmluZWQgJiYgcHJlY2lzaW9uICE9PSBudWxsKSB7XG4gICAgICBzcWwgKz0gc2NhbGUgIT09IHVuZGVmaW5lZCAmJiBzY2FsZSAhPT0gbnVsbCA/IGAoJHtwcmVjaXNpb259LCAke3NjYWxlfSlgIDogYCgke3ByZWNpc2lvbn0pYFxuICAgIH0gZWxzZSBpZiAoZGF0YWJhc2VUeXBlID09IFwibXlzcWxcIiAmJiB0eXBlID09IFwiREFURVRJTUVcIikge1xuICAgICAgc3FsICs9IFwiKDMpXCJcbiAgICB9IGVsc2UgaWYgKHR5cGUgJiYgbWF4bGVuZ3RoICE9PSB1bmRlZmluZWQgJiYgbWF4bGVuZ3RoICE9PSBudWxsKSB7XG4gICAgICBzcWwgKz0gYCgke21heGxlbmd0aH0pYFxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldEF1dG9JbmNyZW1lbnQoKSAmJiBkcml2ZXIuc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkpIHtcbiAgICAgIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJtc3NxbFwiKSB7XG4gICAgICAgIHNxbCArPSBcIiBJREVOVElUWVwiXG4gICAgICB9IGVsc2UgaWYgKGRhdGFiYXNlVHlwZSA9PSBcInBnc3FsXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZ2V0QXV0b0luY3JlbWVudCgpICYmIHRoaXMuZ2V0UHJpbWFyeUtleSgpKSB7XG4gICAgICAgICAgLy8gRG8gbm90aGluZ1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInBnc3FsIGF1dG8gaW5jcmVtZW50IG11c3QgYmUgcHJpbWFyeSBrZXlcIilcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3FsICs9IFwiIEFVVE9fSU5DUkVNRU5UXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSB0aGlzLmdldERlZmF1bHQoKVxuXG4gICAgaWYgKHR5cGVvZiBkZWZhdWx0VmFsdWUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjb25zdCBldmFsdWF0ZWREZWZhdWx0ID0gZGVmYXVsdFZhbHVlKClcblxuICAgICAgc3FsICs9IGAgREVGQVVMVCAoYFxuXG4gICAgICBpZiAoZGF0YWJhc2VUeXBlID09IFwicGdzcWxcIiAmJiBldmFsdWF0ZWREZWZhdWx0ID09IFwiVVVJRCgpXCIpIHtcbiAgICAgICAgc3FsICs9IFwiZ2VuX3JhbmRvbV91dWlkKClcIlxuICAgICAgfSBlbHNlIGlmIChkYXRhYmFzZVR5cGUgPT0gXCJtc3NxbFwiICYmIGV2YWx1YXRlZERlZmF1bHQgPT0gXCJVVUlEKClcIikge1xuICAgICAgICBzcWwgKz0gXCJORVdJRCgpXCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNxbCArPSBldmFsdWF0ZWREZWZhdWx0XG4gICAgICB9XG5cbiAgICAgIHNxbCArPSBcIilcIlxuICAgIH0gZWxzZSBpZiAoZGVmYXVsdFZhbHVlICE9PSB1bmRlZmluZWQgJiYgZGVmYXVsdFZhbHVlICE9PSBudWxsKSB7XG4gICAgICAvLyBFbWl0IGZhbHN5IGRlZmF1bHRzIHRvbyAoYDBgLCBgZmFsc2VgLCBgXCJcImApLiBBIHRydXRoaW5lc3MgY2hlY2sgaGVyZVxuICAgICAgLy8gc2lsZW50bHkgZHJvcHBlZCBgZGVmYXVsdDogMGAsIGxlYXZpbmcgdGhlIGNvbHVtbiBOT1QgTlVMTCB3aXRoIG5vXG4gICAgICAvLyBkZWZhdWx0IHNvIGluc2VydHMgdGhhdCBvbWl0IGl0IGZhaWwgaW4gc3RyaWN0IG1vZGUuXG4gICAgICBzcWwgKz0gYCBERUZBVUxUICR7b3B0aW9ucy5xdW90ZShkZWZhdWx0VmFsdWUpfWBcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRQcmltYXJ5S2V5KCkpIHNxbCArPSBcIiBQUklNQVJZIEtFWVwiXG4gICAgaWYgKHRoaXMuZ2V0TnVsbCgpID09PSBmYWxzZSkgc3FsICs9IFwiIE5PVCBOVUxMXCJcblxuICAgIGNvbnN0IG5vdGVzID0gdGhpcy5nZXROb3Rlc0ZvckRhdGFiYXNlKGRhdGFiYXNlVHlwZSlcblxuICAgIGlmIChub3RlcyAmJiBkYXRhYmFzZVR5cGUgPT0gXCJteXNxbFwiKSB7XG4gICAgICBzcWwgKz0gYCBDT01NRU5UICR7b3B0aW9ucy5xdW90ZShub3Rlcyl9YFxuICAgIH1cblxuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBza2lwRm9yZWlnbktleSA/IHVuZGVmaW5lZCA6IHRoaXMuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICBpZiAoZm9yZWlnbktleSkge1xuICAgICAgbGV0IGZvcmVpZ25LZXlUYWJsZSwgZm9yZWlnbktleUNvbHVtblxuXG4gICAgICBpZiAoZm9yZWlnbktleSA9PT0gdHJ1ZSkge1xuICAgICAgICBmb3JlaWduS2V5Q29sdW1uID0gXCJpZFwiXG4gICAgICAgIGZvcmVpZ25LZXlUYWJsZSA9IGluZmxlY3Rpb24ucGx1cmFsaXplKHRoaXMuZ2V0QWN0dWFsTmFtZSgpLnJlcGxhY2UoL19pZCQvLCBcIlwiKSlcbiAgICAgIH0gZWxzZSBpZiAoZm9yZWlnbktleSBpbnN0YW5jZW9mIFRhYmxlRm9yZWlnbktleSkge1xuICAgICAgICBmb3JlaWduS2V5Q29sdW1uID0gZm9yZWlnbktleS5nZXRSZWZlcmVuY2VkQ29sdW1uTmFtZSgpXG4gICAgICAgIGZvcmVpZ25LZXlUYWJsZSA9IGZvcmVpZ25LZXkuZ2V0UmVmZXJlbmNlZFRhYmxlTmFtZSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZm9yZWlnbiBrZXkgdHlwZSBnaXZlbjogJHtmb3JlaWduS2V5fSAoJHt0eXBlb2YgZm9yZWlnbktleX0pYClcbiAgICAgIH1cblxuICAgICAgc3FsICs9IGAgUkVGRVJFTkNFUyAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUoZm9yZWlnbktleVRhYmxlKX0oJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShmb3JlaWduS2V5Q29sdW1uKX0pYFxuICAgIH1cblxuICAgIHJldHVybiBzcWxcbiAgfVxufVxuIl19