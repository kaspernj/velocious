import QueryBase from "./base.js";
export type CreateIndexBaseArgsType = {
    /**
     * - Columns to include in the index.
     */
    columns: Array<string | import("./../table-data/table-column.js").default>;
    /**
     * - Database driver used to generate SQL.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Skip creation if the index already exists.
     */
    ifNotExists?: boolean;
    /**
     * - Explicit index name to use.
     */
    name?: string;
    /**
     * - Whether the index should enforce uniqueness.
     */
    unique?: boolean;
    /**
     * - Name of the table to add the index to.
     */
    tableName: string;
};
/**
 * CreateIndexBaseArgsType type.
 * @typedef {object} CreateIndexBaseArgsType
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */
export default class VelociousDatabaseQueryCreateIndexBase extends QueryBase {
    columns: (string | import("./../table-data/table-column.js").default)[];
    name: string | undefined;
    tableName: string;
    ifNotExists: boolean | undefined;
    unique: boolean | undefined;
    /**
     * Runs constructor.
     * @param {CreateIndexBaseArgsType} args - Options object.
     */
    constructor({ columns, driver, ifNotExists, name, unique, tableName }: CreateIndexBaseArgsType);
    generateIndexName(): string;
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=create-index-base.d.ts.map