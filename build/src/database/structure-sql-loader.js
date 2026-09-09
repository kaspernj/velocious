// @ts-check
import splitSqlStatements from "../utils/split-sql-statements.js";
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
    async load({ db, structureSql }) {
        const statements = splitSqlStatements(structureSql);
        if (statements.length == 0)
            return;
        const executableConnection = this.executableConnection(db);
        await db.disableForeignKeys();
        try {
            // Prefer a single round-trip for the whole dump: a driver-native multi-statement
            // batch (e.g. MySQL with `multipleStatements`) first, then a native `exec`
            // connection (e.g. SQLite), and finally per-statement execution. Running the
            // whole dump at once is far faster than issuing every CREATE separately.
            if (!await db.execStructureScript(structureSql)) {
                if (executableConnection) {
                    await executableConnection.exec(structureSql);
                }
                else {
                    for (const statement of statements) {
                        await db.query(statement);
                    }
                }
            }
        }
        finally {
            await db.enableForeignKeys();
            // The batch / native `exec` paths mutate the schema outside `Base#query`, so the
            // usual post-DDL schema-cache invalidation never runs. Clear it here so a
            // caller that read schema metadata before provisioning (e.g. an empty table
            // list) does not keep seeing the pre-load schema afterwards. Harmless for the
            // per-statement path, which already invalidates as each DDL statement runs.
            db.clearSchemaCache();
        }
    }
    /**
     * Returns the underlying connection when it exposes a native multi-statement
     * `exec` (a single round-trip for the whole dump), otherwise undefined so the
     * caller falls back to per-statement execution.
     * @param {import("./drivers/base.js").default} db - Database connection.
     * @returns {{exec: (sql: string) => Promise<ReturnType<typeof JSON.parse>>} | undefined} - Connection with exec support.
     */
    executableConnection(db) {
        const dbWithConnection = /** @type {import("./drivers/base.js").default & {connection?: ReturnType<typeof JSON.parse>}} */ (db);
        const connection = dbWithConnection.connection;
        if (connection && typeof connection == "object" && "exec" in connection && typeof connection.exec == "function") {
            return /** @type {{exec: (sql: string) => Promise<ReturnType<typeof JSON.parse>>}} */ (connection);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RydWN0dXJlLXNxbC1sb2FkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2Uvc3RydWN0dXJlLXNxbC1sb2FkZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sa0JBQWtCLE1BQU0sa0NBQWtDLENBQUE7QUFFakU7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0JBQWtCO0lBQ3JDOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBQyxFQUFFLEVBQUUsWUFBWSxFQUFDO1FBQzNCLE1BQU0sVUFBVSxHQUFHLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRW5ELElBQUksVUFBVSxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsT0FBTTtRQUVsQyxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUUxRCxNQUFNLEVBQUUsQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBRTdCLElBQUksQ0FBQztZQUNILGlGQUFpRjtZQUNqRiwyRUFBMkU7WUFDM0UsNkVBQTZFO1lBQzdFLHlFQUF5RTtZQUN6RSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDaEQsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO29CQUN6QixNQUFNLG9CQUFvQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtnQkFDL0MsQ0FBQztxQkFBTSxDQUFDO29CQUNOLEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7d0JBQ25DLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQTtvQkFDM0IsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFFNUIsaUZBQWlGO1lBQ2pGLDBFQUEwRTtZQUMxRSw0RUFBNEU7WUFDNUUsOEVBQThFO1lBQzlFLDRFQUE0RTtZQUM1RSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUN2QixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILG9CQUFvQixDQUFDLEVBQUU7UUFDckIsTUFBTSxnQkFBZ0IsR0FBRyxpR0FBaUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQy9ILE1BQU0sVUFBVSxHQUFHLGdCQUFnQixDQUFDLFVBQVUsQ0FBQTtRQUU5QyxJQUFJLFVBQVUsSUFBSSxPQUFPLFVBQVUsSUFBSSxRQUFRLElBQUksTUFBTSxJQUFJLFVBQVUsSUFBSSxPQUFPLFVBQVUsQ0FBQyxJQUFJLElBQUksVUFBVSxFQUFFLENBQUM7WUFDaEgsT0FBTyw4RUFBOEUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3BHLENBQUM7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHNwbGl0U3FsU3RhdGVtZW50cyBmcm9tIFwiLi4vdXRpbHMvc3BsaXQtc3FsLXN0YXRlbWVudHMuanNcIlxuXG4vKipcbiAqIExvYWRzIGEgZGF0YWJhc2Ugc3RydWN0dXJlIFNRTCBkdW1wIGludG8gYSBjb25uZWN0aW9uIGluIG9uZSBwYXNzLiBGb3JlaWduIGtleXMgYXJlXG4gKiBkaXNhYmxlZCBhcm91bmQgdGhlIGxvYWQgc28gdGFibGVzIGNhbiBiZSBjcmVhdGVkIGluIGFueSBvcmRlciwgYW5kIHRoZSBkcml2ZXInc1xuICogbmF0aXZlIG11bHRpLXN0YXRlbWVudCBgZXhlY2AgaXMgdXNlZCB3aGVuIGF2YWlsYWJsZSAoYSBzaW5nbGUgcm91bmQtdHJpcCkgaW5zdGVhZFxuICogb2YgaXNzdWluZyBldmVyeSBzdGF0ZW1lbnQgc2VwYXJhdGVseS4gVGhpcyBpcyBtdWNoIGZhc3RlciB0aGFuIG1hdGVyaWFsaXppbmcgYVxuICogc2NoZW1hIHRhYmxlIGJ5IHRhYmxlIChlLmcuIGNsb25pbmcpLCBzbyBpdCBpcyB0aGUgcHJlZmVycmVkIHdheSB0byBwcm92aXNpb24gYVxuICogdGVuYW50L3Rlc3QgZGF0YWJhc2UgZnJvbSBhIHN0cnVjdHVyZSBkdW1wLlxuICpcbiAqIFVzZWQgYnkgdGhlIGBkYjpzY2hlbWE6bG9hZGAgQ0xJIGNvbW1hbmQgYW5kIHJldXNhYmxlIGJ5IGFueSBjYWxsZXIgdGhhdCBuZWVkcyB0b1xuICogYXBwbHkgYSBzdHJ1Y3R1cmUgZHVtcCB0byBhIHNwZWNpZmljIGNvbm5lY3Rpb24uXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN0cnVjdHVyZVNxbExvYWRlciB7XG4gIC8qKlxuICAgKiBMb2FkcyBgc3RydWN0dXJlU3FsYCBpbnRvIGBkYmAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRhcmdldCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdHJ1Y3R1cmVTcWwgLSBTdHJ1Y3R1cmUgU1FMIHRvIGxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHN0cnVjdHVyZSBoYXMgYmVlbiBsb2FkZWQuXG4gICAqL1xuICBhc3luYyBsb2FkKHtkYiwgc3RydWN0dXJlU3FsfSkge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBzcGxpdFNxbFN0YXRlbWVudHMoc3RydWN0dXJlU3FsKVxuXG4gICAgaWYgKHN0YXRlbWVudHMubGVuZ3RoID09IDApIHJldHVyblxuXG4gICAgY29uc3QgZXhlY3V0YWJsZUNvbm5lY3Rpb24gPSB0aGlzLmV4ZWN1dGFibGVDb25uZWN0aW9uKGRiKVxuXG4gICAgYXdhaXQgZGIuZGlzYWJsZUZvcmVpZ25LZXlzKClcblxuICAgIHRyeSB7XG4gICAgICAvLyBQcmVmZXIgYSBzaW5nbGUgcm91bmQtdHJpcCBmb3IgdGhlIHdob2xlIGR1bXA6IGEgZHJpdmVyLW5hdGl2ZSBtdWx0aS1zdGF0ZW1lbnRcbiAgICAgIC8vIGJhdGNoIChlLmcuIE15U1FMIHdpdGggYG11bHRpcGxlU3RhdGVtZW50c2ApIGZpcnN0LCB0aGVuIGEgbmF0aXZlIGBleGVjYFxuICAgICAgLy8gY29ubmVjdGlvbiAoZS5nLiBTUUxpdGUpLCBhbmQgZmluYWxseSBwZXItc3RhdGVtZW50IGV4ZWN1dGlvbi4gUnVubmluZyB0aGVcbiAgICAgIC8vIHdob2xlIGR1bXAgYXQgb25jZSBpcyBmYXIgZmFzdGVyIHRoYW4gaXNzdWluZyBldmVyeSBDUkVBVEUgc2VwYXJhdGVseS5cbiAgICAgIGlmICghYXdhaXQgZGIuZXhlY1N0cnVjdHVyZVNjcmlwdChzdHJ1Y3R1cmVTcWwpKSB7XG4gICAgICAgIGlmIChleGVjdXRhYmxlQ29ubmVjdGlvbikge1xuICAgICAgICAgIGF3YWl0IGV4ZWN1dGFibGVDb25uZWN0aW9uLmV4ZWMoc3RydWN0dXJlU3FsKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvciAoY29uc3Qgc3RhdGVtZW50IG9mIHN0YXRlbWVudHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHN0YXRlbWVudClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIuZW5hYmxlRm9yZWlnbktleXMoKVxuXG4gICAgICAvLyBUaGUgYmF0Y2ggLyBuYXRpdmUgYGV4ZWNgIHBhdGhzIG11dGF0ZSB0aGUgc2NoZW1hIG91dHNpZGUgYEJhc2UjcXVlcnlgLCBzbyB0aGVcbiAgICAgIC8vIHVzdWFsIHBvc3QtRERMIHNjaGVtYS1jYWNoZSBpbnZhbGlkYXRpb24gbmV2ZXIgcnVucy4gQ2xlYXIgaXQgaGVyZSBzbyBhXG4gICAgICAvLyBjYWxsZXIgdGhhdCByZWFkIHNjaGVtYSBtZXRhZGF0YSBiZWZvcmUgcHJvdmlzaW9uaW5nIChlLmcuIGFuIGVtcHR5IHRhYmxlXG4gICAgICAvLyBsaXN0KSBkb2VzIG5vdCBrZWVwIHNlZWluZyB0aGUgcHJlLWxvYWQgc2NoZW1hIGFmdGVyd2FyZHMuIEhhcm1sZXNzIGZvciB0aGVcbiAgICAgIC8vIHBlci1zdGF0ZW1lbnQgcGF0aCwgd2hpY2ggYWxyZWFkeSBpbnZhbGlkYXRlcyBhcyBlYWNoIERETCBzdGF0ZW1lbnQgcnVucy5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24gd2hlbiBpdCBleHBvc2VzIGEgbmF0aXZlIG11bHRpLXN0YXRlbWVudFxuICAgKiBgZXhlY2AgKGEgc2luZ2xlIHJvdW5kLXRyaXAgZm9yIHRoZSB3aG9sZSBkdW1wKSwgb3RoZXJ3aXNlIHVuZGVmaW5lZCBzbyB0aGVcbiAgICogY2FsbGVyIGZhbGxzIGJhY2sgdG8gcGVyLXN0YXRlbWVudCBleGVjdXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7e2V4ZWM6IChzcWw6IHN0cmluZykgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgdW5kZWZpbmVkfSAtIENvbm5lY3Rpb24gd2l0aCBleGVjIHN1cHBvcnQuXG4gICAqL1xuICBleGVjdXRhYmxlQ29ubmVjdGlvbihkYikge1xuICAgIGNvbnN0IGRiV2l0aENvbm5lY3Rpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7Y29ubmVjdGlvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKGRiKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYldpdGhDb25uZWN0aW9uLmNvbm5lY3Rpb25cblxuICAgIGlmIChjb25uZWN0aW9uICYmIHR5cGVvZiBjb25uZWN0aW9uID09IFwib2JqZWN0XCIgJiYgXCJleGVjXCIgaW4gY29ubmVjdGlvbiAmJiB0eXBlb2YgY29ubmVjdGlvbi5leGVjID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7e2V4ZWM6IChzcWw6IHN0cmluZykgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAoY29ubmVjdGlvbilcbiAgICB9XG4gIH1cbn1cbiJdfQ==