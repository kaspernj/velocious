// @ts-check

/**
 * Deletes project rows for a marker using a fresh independent connection.
 * @param {import("../../src/configuration.js").default} configuration - Test configuration.
 * @param {string} marker - Unique project marker.
 * @returns {Promise<void>} - Resolves after matching rows are deleted.
 */
export async function deleteProjectMarker(configuration, marker) {
  await configuration.withoutCurrentConnectionContexts(async () => {
    await configuration.withConnections(async (dbs) => {
      const projectsTable = dbs.default.quoteTable("projects")
      const markerColumn = dbs.default.quoteColumn("creating_user_reference")

      await dbs.default.query(
        `DELETE FROM ${projectsTable} WHERE ${markerColumn} = ${dbs.default.quote(marker)}`
      )
    })
  })
}

/**
 * Selects project rows for a marker using a fresh independent connection.
 * @param {import("../../src/configuration.js").default} configuration - Test configuration.
 * @param {string} marker - Unique project marker.
 * @returns {Promise<{creating_user_reference: string}[]>} - Matching marker rows.
 */
export async function projectMarkerRows(configuration, marker) {
  return await configuration.withoutCurrentConnectionContexts(async () => {
    return await configuration.withConnections(async (dbs) => {
      const projectsTable = dbs.default.quoteTable("projects")
      const markerColumn = dbs.default.quoteColumn("creating_user_reference")

      return await dbs.default.query(
        `SELECT ${markerColumn} AS creating_user_reference FROM ${projectsTable} WHERE ${markerColumn} = ${dbs.default.quote(marker)}`
      )
    })
  })
}
