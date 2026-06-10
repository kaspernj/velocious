// @ts-check

/**
 * @typedef {{_associationCounts?: Map<string, number>, _computedAbilities?: Map<string, boolean>, _queryDataValues?: Map<string, unknown>}} RecordPayloadValuesTarget
 */

/**
 * Read an association count attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding association count payload values.
 * @param {string} attributeName - Association count attribute name.
 * @returns {number} Attached count value, or 0 when it was not loaded.
 */
export function readPayloadAssociationCount(target, attributeName) {
  if (!target._associationCounts) return 0
  if (!target._associationCounts.has(attributeName)) return 0

  return /** @type {number} */ (target._associationCounts.get(attributeName))
}

/**
 * Store an association count attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding association count payload values.
 * @param {string} attributeName - Association count attribute name.
 * @param {number} value - Count value.
 * @returns {void}
 */
export function setPayloadAssociationCount(target, attributeName, value) {
  if (!target._associationCounts) target._associationCounts = new Map()

  target._associationCounts.set(attributeName, value)
}

/**
 * Read a computed ability attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding ability payload values.
 * @param {string} action - Ability action name.
 * @returns {boolean} Attached ability value, or false when it was not loaded.
 */
export function readPayloadComputedAbility(target, action) {
  if (!target._computedAbilities) return false
  if (!target._computedAbilities.has(action)) return false

  return Boolean(target._computedAbilities.get(action))
}

/**
 * Store a computed ability attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding ability payload values.
 * @param {string} action - Ability action name.
 * @param {boolean} value - Whether the current ability permits the action on this record.
 * @returns {void}
 */
export function setPayloadComputedAbility(target, action, value) {
  if (!target._computedAbilities) target._computedAbilities = new Map()

  target._computedAbilities.set(action, Boolean(value))
}

/**
 * Read a queryData value attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding queryData payload values.
 * @param {string} name - queryData alias name.
 * @returns {unknown} Attached queryData value, or null when it was not loaded.
 */
export function readPayloadQueryData(target, name) {
  if (!target._queryDataValues) return null
  if (!target._queryDataValues.has(name)) return null

  return target._queryDataValues.get(name)
}

/**
 * Store a queryData value attached to a record/frontend-model payload.
 * @param {RecordPayloadValuesTarget} target - Record-like object holding queryData payload values.
 * @param {string} name - queryData alias name.
 * @param {unknown} value - Attached queryData value.
 * @returns {void}
 */
export function setPayloadQueryData(target, name, value) {
  if (!target._queryDataValues) target._queryDataValues = new Map()

  target._queryDataValues.set(name, value)
}
