/**
 * Loads a database structure SQL dump into a connection in one pass. Foreign keys are
 * disabled around the load so tables can be created in any order, and the driver's
 * native multi-statement `exec` is used when available (a single round-trip) instead
 * of issuing every statement separately. This is much faster than materializing a
 * schema table by table (e.g. cloning), so it is the preferred way to provision a
 * tenant/test database from a structure dump.
 *
 * Used by the `db:schema:load` CLI command and reusable by any caller that needs to
 * apply a structure dump to a specific connection.
 */
export default class StructureSqlLoader {
    /**
     * Loads `structureSql` into `db`.
     * @param {object} args - Options object.
     * @param {import("./drivers/base.js").default} args.db - Target database connection.
     * @param {string} args.structureSql - Structure SQL to load.
     * @returns {Promise<void>} - Resolves when the structure has been loaded.
     */
    load({ db, structureSql }: {
        db: import("./drivers/base.js").default;
        structureSql: string;
    }): Promise<void>;
    /**
     * Returns the underlying connection when it exposes a native multi-statement
     * `exec` (a single round-trip for the whole dump), otherwise undefined so the
     * caller falls back to per-statement execution.
     * @param {import("./drivers/base.js").default} db - Database connection.
     * @returns {{exec: (sql: string) => Promise<ReturnType<typeof JSON.parse>>} | undefined} - Connection with exec support.
     */
    executableConnection(db: import("./drivers/base.js").default): {
        exec: (sql: string) => Promise<ReturnType<typeof JSON.parse>>;
    } | undefined;
}
//# sourceMappingURL=structure-sql-loader.d.ts.map