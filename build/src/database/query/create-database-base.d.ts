export type CreateDatabaseArgsType = {
    /**
     * - Database driver used to generate SQL.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Name of the database to create.
     */
    databaseName: string;
    /**
     * - Skip creation if the database already exists.
     */
    ifNotExists?: boolean;
    /**
     * - Database-default character set (driver-specific; currently used by mysql).
     */
    databaseCharset?: string;
    /**
     * - Database-default collation (driver-specific; currently used by mysql).
     */
    databaseCollation?: string;
};
/**
 * CreateDatabaseArgsType type.
 * @typedef {object} CreateDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to create.
 * @property {boolean} [ifNotExists] - Skip creation if the database already exists.
 * @property {string} [databaseCharset] - Database-default character set (driver-specific; currently used by mysql).
 * @property {string} [databaseCollation] - Database-default collation (driver-specific; currently used by mysql).
 */
import QueryBase from "./base.js";
export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
    databaseName: string;
    ifNotExists: boolean | undefined;
    databaseCharset: string | undefined;
    databaseCollation: string | undefined;
    /**
     * Runs constructor.
     * @param {CreateDatabaseArgsType} args - Options object.
     */
    constructor({ driver, databaseName, ifNotExists, databaseCharset, databaseCollation }: CreateDatabaseArgsType);
    /**
     * Runs to sql.
     * @returns {string[]} - SQL statements.
     */
    toSql(): string[];
}
//# sourceMappingURL=create-database-base.d.ts.map