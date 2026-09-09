import BaseCommand from "../../../../../../cli/base-command.js";
/** Node CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} */
    execute(): Promise<void>;
    /**
     * Loads one identifier's explicit structure file into one selected connection.
     * @param {object} args - Load arguments.
     * @param {import("../../../../../../database/drivers/base.js").default} args.db - Target connection.
     * @param {string} args.identifier - Logical database identifier used in the file name.
     * @returns {Promise<void>} - Resolves after loading.
     */
    loadStructureSql({ db, identifier }: {
        db: import("../../../../../../database/drivers/base.js").default;
        identifier: string;
    }): Promise<void>;
}
//# sourceMappingURL=load.d.ts.map