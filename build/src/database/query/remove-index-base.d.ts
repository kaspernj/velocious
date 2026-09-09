import QueryBase from "./base.js";
export type RemoveIndexBaseArgsType = {
    /**
     * - Database driver used to generate SQL.
     */
    driver: import("../drivers/base.js").default;
    /**
     * - Index name to drop.
     */
    name: string;
    /**
     * - Name of the table the index belongs to.
     */
    tableName: string;
};
/**
 * RemoveIndexBaseArgsType type.
 * @typedef {object} RemoveIndexBaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} name - Index name to drop.
 * @property {string} tableName - Name of the table the index belongs to.
 */
export default class VelociousDatabaseQueryRemoveIndexBase extends QueryBase {
    name: string;
    tableName: string;
    /**
     * Runs constructor.
     * @param {RemoveIndexBaseArgsType} args - Options object.
     */
    constructor({ driver, name, tableName }: RemoveIndexBaseArgsType);
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=remove-index-base.d.ts.map