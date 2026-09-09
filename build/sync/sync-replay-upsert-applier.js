// @ts-check

import {optionalFloat, optionalInteger, optionalString} from "typanic"

import SyncApiClient from "./sync-api-client.js"

/**
 * Coercers for the declarative sync field types. All are present-key based:
 * a field is only applied when its key exists in the mutation data.
 * @type {Record<string, (value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>>}
 */
const FIELD_TYPES = {
  booleanOrNull: (value, label) => SyncApiClient.optionalBooleanSyncValue(value, label),
  dateOrNull: (value, label) => optionalSyncDate(value, label),
  floatOrNull: (value, label) => optionalFloat(value, label),
  integerOrNull: (value, label) => optionalInteger(value, label),
  raw: (value) => value,
  stringOrNull: (value, label) => optionalString(value, label)
}

/**
 * Parses an optional date value, failing loudly on invalid input.
 * @param {ReturnType<typeof JSON.parse>} value - Date, parseable string, or epoch number.
 * @param {string} label - Field label for error messages.
 * @returns {Date | null} Parsed date or null when absent.
 */
function optionalSyncDate(value, label) {
  if (value === null || value === undefined) return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  if (typeof value === "string" || typeof value === "number") {
    const dateValue = new Date(value)

    if (!Number.isNaN(dateValue.getTime())) return dateValue
  }

  throw new Error(`Expected ${label} to be a valid date or null`)
}

/**
 * Declarative field-map upsert applier for sync replay mutations.
 *
 * Owns the generic mechanics every per-resource replay handler repeats:
 * present-key filtering, per-field type coercion, unknown-key rejection, the
 * find-or-create upsert, the delete branch, optional snapshot serialization,
 * and the domain after-apply tail. Apps declare only the field map and hooks.
 * @deprecated Prefer resource-routed replay (`SyncEnvelopeReplayService` with `configuration`/`resourceTypeOverrides` and resource `writableAttributes` permit lists) — value casting and validation belong to the record layer. This applier remains for released applyHandlers adopters and will be removed after their migration.
 */
export default class SyncReplayUpsertApplier {
  /**
   * Creates a declarative upsert applier.
   * @param {object} args - Applier configuration.
   * @param {ReturnType<typeof JSON.parse>} args.modelClass - Model class receiving the mutations.
   * @param {Record<string, string | {type: string, column?: string} | ((value: ReturnType<typeof JSON.parse>, label: string) => ReturnType<typeof JSON.parse>)>} args.fields - Data-key → field-type map: a named type, a {type, column} rename spec, "ignored" for accepted-but-dropped keys, or a custom coercer function.
   * @param {(args: {data: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecord] - Custom record resolver. Defaults to findBy({id: mutation.resourceId}).
   * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}) => Promise<ReturnType<typeof JSON.parse>>} [args.findRecordForDelete] - Custom delete resolver. Defaults to findRecord.
   * @param {"error" | "ignore"} [args.restArgs] - Unknown data-key handling. Defaults to "error".
   * @param {(args: {mappedAttributes: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>> | void>} [args.afterApply] - Domain tail; its returned object merges into the apply result.
   * @param {(args: {mutation: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, record: ReturnType<typeof JSON.parse>}) => Promise<Record<string, ReturnType<typeof JSON.parse>>> | Record<string, ReturnType<typeof JSON.parse>>} [args.serialize] - Snapshot serializer; result lands on applyResult.serializedData.
   */
  constructor({afterApply, fields, findRecord, findRecordForDelete, modelClass, restArgs = "error", serialize}) {
    if (!modelClass) throw new Error("SyncReplayUpsertApplier requires a modelClass")
    if (!fields || typeof fields !== "object") throw new Error("SyncReplayUpsertApplier requires a fields map")
    if (restArgs !== "error" && restArgs !== "ignore") {
      throw new Error(`SyncReplayUpsertApplier restArgs must be "error" or "ignore", got: ${String(restArgs)}`)
    }

    for (const [fieldName, fieldSpec] of Object.entries(fields)) {
      if (typeof fieldSpec === "function") continue

      const fieldType = typeof fieldSpec === "string" ? fieldSpec : fieldSpec.type

      if (fieldType !== "ignored" && !(fieldType in FIELD_TYPES)) {
        throw new Error(`Unknown sync field type: ${fieldType} for: ${fieldName}`)
      }
    }

    this.afterApply = afterApply
    this.fields = fields
    this.findRecord = findRecord
    this.findRecordForDelete = findRecordForDelete
    this.modelClass = modelClass
    this.restArgs = restArgs
    this.serialize = serialize
  }

  /**
   * Applies one normalized replay mutation to the declared model.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: ReturnType<typeof JSON.parse>}} args - Replay apply arguments.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the record, created/deleted flags, optional serializedData, and afterApply extras.
   */
  async apply({context, mutation}) {
    if (mutation.syncType === "delete") return await this.applyDelete({context, mutation})

    const mappedAttributes = this.mappedAttributes(mutation.data)
    const record = this.findRecord
      ? await this.findRecord({context, data: mutation.data, mutation})
      : await this.modelClass.findBy({id: mutation.resourceId})
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const result = {created: false, deleted: false, record: null}

    if (record) {
      record.assign(mappedAttributes)
      await record.save()
      result.record = record
    } else {
      result.record = await this.modelClass.create({id: mutation.resourceId, ...mappedAttributes})
      result.created = true
    }

    if (this.serialize) result.serializedData = await this.serialize({context, mutation, record: result.record})

    if (this.afterApply) {
      const afterApplyResult = await this.afterApply({context, mappedAttributes, mutation, record: result.record})

      if (afterApplyResult && typeof afterApplyResult === "object") Object.assign(result, afterApplyResult)
    }

    return result
  }

  /**
   * Applies a delete mutation to the declared model.
   * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: ReturnType<typeof JSON.parse>}} args - Delete arguments.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the deleted flag.
   */
  async applyDelete({context, mutation}) {
    const resolveRecord = this.findRecordForDelete || this.findRecord
    const record = resolveRecord
      ? await resolveRecord({context, data: mutation.data, mutation})
      : await this.modelClass.findBy({id: mutation.resourceId})

    if (!record) return {created: false, deleted: false, record: null}

    await record.destroy()

    return {created: false, deleted: true, record}
  }

  /**
   * Maps present data keys through the declared field types.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Normalized mutation data.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Coerced attributes keyed by column name.
   */
  mappedAttributes(data) {
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const mappedAttributes = {}
    /** @type {string[]} */
    const unknownKeys = []

    for (const [dataKey, value] of Object.entries(data)) {
      const fieldSpec = this.fields[dataKey]

      if (!fieldSpec) {
        unknownKeys.push(dataKey)
        continue
      }

      if (typeof fieldSpec === "function") {
        mappedAttributes[dataKey] = fieldSpec(value, dataKey)
        continue
      }

      const fieldType = typeof fieldSpec === "string" ? fieldSpec : fieldSpec.type

      if (fieldType === "ignored") continue

      const column = typeof fieldSpec === "string" ? dataKey : fieldSpec.column || dataKey

      mappedAttributes[column] = FIELD_TYPES[fieldType](value, dataKey)
    }

    if (unknownKeys.length > 0 && this.restArgs === "error") {
      throw new Error(`Unknown sync data keys: ${unknownKeys.join(", ")}`)
    }

    return mappedAttributes
  }
}
