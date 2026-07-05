// @ts-check

/**
 * Builds a fake local pending-sync model compatible with the sync client.
 * Browser-bundle safe (no Node-only imports) so realtime browser specs can use it too.
 * @returns {?} Fake sync model with a rows array.
 */
export function buildFakeSyncModel() {
  /** @type {Array<?>} */
  const rows = []
  let nextId = 1

  /**
   * @param {Record<string, ?>} attributes - Row attributes.
   * @returns {?} Fake sync row.
   */
  const buildRow = (attributes) => {
    const row = {
      attributes: {...attributes, id: nextId++},
      createdAt: () => new Date("2026-07-01T10:00:00.000Z"),
      data: () => row.attributes.data,
      id: () => row.attributes.id,
      resource: () => null,
      resourceId: () => row.attributes.resourceId,
      resourceType: () => row.attributes.resourceType,
      syncType: () => row.attributes.syncType,
      /** @param {Record<string, ?>} newAttributes - Updated attributes. @returns {Promise<void>} */
      update: async (newAttributes) => {
        Object.assign(row.attributes, newAttributes)
      },
      updatedAt: () => new Date("2026-07-01T10:00:00.000Z")
    }

    return row
  }

  return {
    /** @param {Record<string, ?>} attributes - Row attributes. @returns {Promise<?>} Created row. */
    create: async (attributes) => {
      const row = buildRow(attributes)

      rows.push(row)

      return row
    },
    /** @param {Record<string, ?>} conditions - Lookup conditions. @returns {Promise<?>} Existing row. */
    findBy: async (conditions) => {
      if ("id" in conditions) return rows.find((row) => row.attributes.id === conditions.id) || null

      return rows.find((row) => row.attributes.resourceId === conditions.resourceId && row.attributes.resourceType === conditions.resourceType) || null
    },
    preload: () => ({
      /** @param {Record<string, ?>} conditions - Where conditions. @returns {?} Chainable query. */
      where: (conditions) => ({
        first: async () => rows.find((row) => row.attributes.id === conditions.id) || null,
        order: () => ({
          toArray: async () => rows.filter((row) => row.attributes.state === conditions.state)
        })
      })
    }),
    rows
  }
}
