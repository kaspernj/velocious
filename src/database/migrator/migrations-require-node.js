/**
 * @param {string} filePath
 * @template T extends import ("../migration/index.js").default
 * @returns {Promise<T>}
*/
export default async function migrationsRequireNode(filePath) {
  const migrationImport = await import(filePath)

  if (!migrationImport.default) throw new Error("Migration file must export a default migration class")

  return migrationImport.default
}
