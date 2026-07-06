// @ts-check

/**
 * Reads and validates a sync/change model's declared scope-partition
 * attributes (`static syncScopeAttributes`).
 *
 * The declaration names the attribute(s) partitioning the app's sync feed —
 * the same attribute names client pull scopes use as conditions (for example
 * `["eventId"]` or `["accountId"]`). The publisher persists them onto every
 * published sync row and broadcasts them as the framework sync channel's
 * scoping params, and the change feed serializes them onto every changes row
 * under their own names. Velocious itself has no built-in partition name.
 * @param {?} syncModel - Sync/change model class.
 * @returns {string[] | null} Declared scope attributes, or null when the model declares none.
 */
export function declaredSyncScopeAttributes(syncModel) {
  const declared = syncModel.syncScopeAttributes

  if (declared === undefined || declared === null) return null

  if (!Array.isArray(declared) || declared.length === 0 || declared.some((attributeName) => typeof attributeName !== "string" || !attributeName)) {
    throw new Error(`${syncModel.name} static syncScopeAttributes must be a non-empty array of attribute-name strings, got: ${String(declared)}`)
  }

  return declared
}
