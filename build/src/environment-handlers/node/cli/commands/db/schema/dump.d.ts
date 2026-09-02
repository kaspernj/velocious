import BaseCommand from "../../../../../../cli/base-command.js";
/** Node CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} */
    execute(): Promise<void>;
    /**
     * Runs should generate structure sql.
     * @param {object} args - Options object.
     * @param {Record<string, import("../../../../../../database/drivers/base.js").default>} args.dbs - Active DB connections by identifier.
     * @returns {Promise<boolean>} - Whether structure SQL should be generated.
     */
    shouldGenerateStructureSql({ dbs }: {
        dbs: Record<string, import("../../../../../../database/drivers/base.js").default>;
    }): Promise<boolean>;
}
//# sourceMappingURL=dump.d.ts.map