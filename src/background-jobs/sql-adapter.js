// @ts-check

import BackgroundJobsStore from "./store.js"

/** Built-in SQL adapter preserving the existing durable store implementation. */
export default class SqlBackgroundJobsAdapter extends BackgroundJobsStore {
  /**
   * Declares generation capability.
   * @returns {boolean} - The built-in SQL store implements exact generation fencing.
   */
  supportsReleaseScopedGenerations() { return true }

  /**
   * Ensures the built-in SQL schema during migration.
   * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} args - Migrated databases.
   * @returns {Promise<void>} - Resolves when the SQL schema is present.
   */
  async ensureFrameworkSchema({dbs}) {
    const databaseIdentifier = this.getDatabaseIdentifier() || "default"
    const frameworkDb = dbs[databaseIdentifier]

    if (!frameworkDb) return

    await this.ensureSchema(frameworkDb)
  }
}
