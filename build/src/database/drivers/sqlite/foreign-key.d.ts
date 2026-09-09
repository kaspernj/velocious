import BaseForeignKey from "../base-foreign-key.js";
export default class VelociousDatabaseDriversSqliteForeignKey extends BaseForeignKey {
    tableName: string;
    /**
     * Runs constructor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     * @param {object} args - Options object.
     * @param {string} args.tableName - Table name.
     */
    constructor(data: Record<string, ReturnType<typeof JSON.parse>>, { tableName }: {
        tableName: string;
    });
    getColumnName(): any;
    getName(): string;
    getTableName(): any;
    getReferencedColumnName(): any;
    getReferencedTableName(): any;
}
//# sourceMappingURL=foreign-key.d.ts.map