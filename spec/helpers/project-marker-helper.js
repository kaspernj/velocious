// @ts-check

import Project from "../dummy/src/models/project.js"

/**
 * Deletes project rows for a marker using a fresh independent connection.
 * @param {import("../../src/configuration.js").default} configuration - Test configuration.
 * @param {string} marker - Unique project marker.
 * @returns {Promise<void>} - Resolves after matching rows are deleted.
 */
export async function deleteProjectMarker(configuration, marker) {
  await configuration.withoutCurrentConnectionContexts(async () => {
    await configuration.withConnections(async () => {
      await Project.ensureInitialized()
      await Project
        .where({creatingUserReference: marker})
        .destroyAll()
    })
  })
}

/**
 * Selects project rows for a marker using a fresh independent connection.
 * @param {import("../../src/configuration.js").default} configuration - Test configuration.
 * @param {string} marker - Unique project marker.
 * @returns {Promise<Project[]>} - Matching project records.
 */
export async function projectMarkerRows(configuration, marker) {
  return await configuration.withoutCurrentConnectionContexts(async () => {
    return await configuration.withConnections(async () => {
      await Project.ensureInitialized()

      return await Project
        .where({creatingUserReference: marker})
        .toArray()
    })
  })
}
