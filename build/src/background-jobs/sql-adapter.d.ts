import BackgroundJobsStore from "./store.js";
/** Built-in SQL adapter preserving the existing durable store implementation. */
export default class SqlBackgroundJobsAdapter extends BackgroundJobsStore {
    /**
     * Declares generation capability.
     * @returns {boolean} - The built-in SQL store implements exact generation fencing.
     */
    supportsReleaseScopedGenerations(): boolean;
    /**
     * Ensures the built-in SQL schema during migration.
     * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} args - Migrated databases.
     * @returns {Promise<void>} - Resolves when the SQL schema is present.
     */
    ensureFrameworkSchema({ dbs }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<void>;
}
//# sourceMappingURL=sql-adapter.d.ts.map