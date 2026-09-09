export type DropDatabaseArgsType = {
    /**
     * - Database driver used to generate SQL.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Name of the database to drop.
     */
    databaseName: string;
    /**
     * - Skip drop if the database does not exist.
     */
    ifExists?: boolean;
};
/**
 * DropDatabaseArgsType type.
 * @typedef {object} DropDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to drop.
 * @property {boolean} [ifExists] - Skip drop if the database does not exist.
 */
import QueryBase from "./base.js";
export default class VelociousDatabaseQueryDropDatabaseBase extends QueryBase {
    databaseName: string;
    ifExists: boolean | undefined;
    /**
     * Runs constructor.
     * @param {DropDatabaseArgsType} args - Options object.
     */
    constructor({ driver, databaseName, ifExists }: DropDatabaseArgsType);
    /**
     * Runs to sql.
     * @returns {string[]} - SQL statements.
     */
    toSql(): string[];
}
//# sourceMappingURL=drop-database-base.d.ts.map