/**
 * Runs the normalizeSqlStatement helper.
 * @param {string} statement - Statement.
 * @returns {string} - SQL string.
 */
export declare function normalizeSqlStatement(statement: string): string;
/**
 * Runs the normalizeCreateStatement helper.
 * @param {object} args - Options object.
 * @param {import("../base.js").default} args.db - Database connection.
 * @param {string} args.objectName - Object name.
 * @param {string} args.statement - Statement.
 * @param {string} args.type - Type identifier.
 * @returns {string} - The create statement.
 */
export declare function normalizeCreateStatement({ db, objectName, statement, type }: {
    db: import("../base.js").default;
    objectName: string;
    statement: string;
    type: string;
}): string;
//# sourceMappingURL=utils.d.ts.map