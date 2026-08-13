// @ts-check

/**
 * Builds a frontend-compatible migration require context.
 * @param {Record<string, typeof import("../../src/database/migration/index.js").default>} migrations - Migration classes keyed by require-context filename.
 * @returns {import("../../src/database/migrator/types.js").RequireMigrationContextType} - Migration require context.
 */
export function buildFrontendMigrationContext(migrations) {
  const context = /** @type {import("../../src/database/migrator/types.js").RequireMigrationContextType} */ ((fileName) => ({default: migrations[fileName]}))

  context.keys = () => Object.keys(migrations)
  context.id = "frontend-tenant-migration-test-helper"

  return context
}

/**
 * Resolves the tenant slug encoded by the real SQLite test configuration.
 * @param {import("../../src/database/drivers/base.js").default} db - Tenant database connection.
 * @returns {"alpha" | "beta"} - Tenant slug.
 */
export function tenantSlugFromDatabase(db) {
  const name = db.getArgs().name

  if (typeof name !== "string") throw new Error("Expected tenant SQLite database name")

  return name.endsWith("-alpha") ? "alpha" : "beta"
}
