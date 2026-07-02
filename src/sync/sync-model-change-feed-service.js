// @ts-check

import VelociousError from "../velocious-error.js"

/**
 * Generic cursor-paginated change feed over an app-owned sync/change model.
 *
 * Apps provide the model and optional scoping/serialization hooks. Velocious owns
 * cursor parsing, snapshot high-water resolution, stable ordering, page limits,
 * and response shape for `/velocious/sync/changes` style endpoints.
 */
export default class SyncModelChangeFeedService {
  /**
   * Creates a generic sync-model change-feed service.
   * @param {object} args - Service arguments.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Sync/change model class.
   * @param {Record<string, unknown>} args.params - Request params.
   * @param {number} [args.defaultLimit] - Default page size.
   * @param {number} [args.maxLimit] - Maximum page size.
   * @param {(record: ?) => Record<string, unknown>} [args.serializeRecord] - Record serializer.
   * @param {function({query: import("../database/query/model-class-query.js").default}): void} [args.scopeQuery] - Applies app-owned visibility scope.
   */
  constructor({defaultLimit = 1000, maxLimit = 1000, modelClass, params, scopeQuery, serializeRecord}) {
    this.defaultLimit = defaultLimit
    this.maxLimit = maxLimit
    this.modelClass = modelClass
    this.params = params
    this.scopeQuery = scopeQuery || null
    this.serializeRecord = serializeRecord || ((record) => this.defaultSerializeRecord(record))
  }

  /**
   * Builds a stable change-feed page.
   * @returns {Promise<{status: string, nextCursor: {id: string, serverSequence: number, updatedAt: string} | null, syncs: Array<Record<string, unknown>>, upToCursor: {id: string, serverSequence: number, updatedAt: string} | null}>} Change-feed page result.
   */
  async changes() {
    const limit = this.normalizedLimit(this.params.limit)
    const upToCursor = await this.resolveUpToCursor()

    if (!upToCursor) return {status: "success", nextCursor: null, syncs: [], upToCursor: null}

    const query = this.pageQuery({limit, upToCursor})
    const records = await query.toArray()
    const nextCursor = records.length > 0 ? this.cursorForRecord(records[records.length - 1]) : upToCursor

    return {
      status: "success",
      nextCursor,
      syncs: records.map((record) => this.serializeRecord(record)),
      upToCursor
    }
  }

  /**
   * Normalizes the requested page limit.
   * @param {unknown} value - Raw limit param.
   * @returns {number} Normalized page limit.
   */
  normalizedLimit(value) {
    if (value === undefined || value === null || value === "") return this.defaultLimit

    const limit = Number(value)

    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw VelociousError.safe("Sync changes limit must be a positive integer.", {code: "sync-invalid-changes-limit"})
    }

    return Math.min(limit, this.maxLimit)
  }

  /**
   * Parses an optional positive integer cursor field.
   * @param {unknown} value - Raw integer param.
   * @param {string} name - Param name for error messages.
   * @returns {number | null} Positive integer value, or null when omitted.
   */
  optionalPositiveIntegerParam(value, name) {
    if (value === undefined || value === null || value === "") return null

    const integer = Number(value)

    if (!Number.isSafeInteger(integer) || integer <= 0) {
      throw VelociousError.safe(`${name} must be a positive integer.`, {code: "sync-invalid-changes-cursor"})
    }

    return integer
  }

  /**
   * Resolves the high-water cursor that bounds the current feed page.
   * @returns {Promise<{id: string, serverSequence: number, updatedAt: string} | null>} Snapshot upper-bound cursor.
   */
  async resolveUpToCursor() {
    const upToServerSequence = this.optionalPositiveIntegerParam(this.params.upToServerSequence, "upToServerSequence")

    if (upToServerSequence !== null && typeof this.params.upToUpdatedAt === "string" && typeof this.params.upToId === "string") {
      return {id: this.params.upToId, serverSequence: upToServerSequence, updatedAt: this.params.upToUpdatedAt}
    }

    if (typeof this.params.upToUpdatedAt === "string" && typeof this.params.upToId === "string") {
      const upToRecord = await this.modelClass.findBy({id: this.params.upToId})

      if (upToRecord) return this.cursorForRecord(upToRecord)
    }

    const query = this.scopedQuery()
    const table = query.driver.quoteTable(this.modelClass.tableName())
    const serverSequenceColumn = query.driver.quoteColumn("server_sequence")
    const latestRecords = await query
      .order(`${table}.${serverSequenceColumn} DESC`)
      .limit(1)
      .toArray()

    if (latestRecords.length === 0) return null

    return this.cursorForRecord(latestRecords[0])
  }

  /**
   * Builds the ordered and cursor-filtered page query.
   * @param {{limit: number, upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Page query args.
   * @returns {import("../database/query/model-class-query.js").default} Page query.
   */
  pageQuery({limit, upToCursor}) {
    const query = this.scopedQuery()
    const driver = query.driver
    const table = driver.quoteTable(this.modelClass.tableName())
    const serverSequenceColumn = `${table}.${driver.quoteColumn("server_sequence")}`
    const updatedAtColumn = `${table}.${driver.quoteColumn("updated_at")}`
    const idColumn = `${table}.${driver.quoteColumn("id")}`

    query
      .where(`${serverSequenceColumn} <= ${driver.quote(upToCursor.serverSequence)}`)
      .order(`${serverSequenceColumn} ASC`)
      .limit(limit)

    const afterServerSequence = this.optionalPositiveIntegerParam(this.params.afterServerSequence, "afterServerSequence")

    if (afterServerSequence !== null) {
      query.where(`${serverSequenceColumn} > ${driver.quote(afterServerSequence)}`)
    } else if (typeof this.params.afterUpdatedAt === "string" && this.params.afterUpdatedAt !== "") {
      const isPagingExistingSnapshot = typeof this.params.upToUpdatedAt === "string" && this.params.upToUpdatedAt !== "" && typeof this.params.upToId === "string" && this.params.upToId !== ""

      if (isPagingExistingSnapshot && typeof this.params.afterId === "string" && this.params.afterId !== "") {
        query.where(`(${updatedAtColumn} > ${driver.quote(this.params.afterUpdatedAt)} OR (${updatedAtColumn} = ${driver.quote(this.params.afterUpdatedAt)} AND ${idColumn} > ${driver.quote(this.params.afterId)}))`)
      } else {
        query.where(`${updatedAtColumn} >= ${driver.quote(this.params.afterUpdatedAt)}`)
      }
    }

    return query
  }

  /**
   * Builds a base query with app-owned scope applied.
   * @returns {import("../database/query/model-class-query.js").default} Scoped base query.
   */
  scopedQuery() {
    const query = this.modelClass.where({})

    if (this.scopeQuery) this.scopeQuery({query})

    return query
  }

  /**
   * Serializes a record into a transport cursor.
   * @param {?} record - Sync/change record.
   * @returns {{id: string, serverSequence: number, updatedAt: string}} Cursor for row.
   */
  cursorForRecord(record) {
    return {id: String(this.recordValue(record, "id")), serverSequence: Number(this.recordValue(record, "serverSequence")), updatedAt: this.isoDate(this.recordValue(record, "updatedAt"))}
  }

  /**
   * Serializes a record using the standard sync envelope shape.
   * @param {?} record - Sync/change record.
   * @returns {Record<string, unknown>} Default serialized row.
   */
  defaultSerializeRecord(record) {
    return {
      data: this.recordData(record),
      eventId: this.recordValue(record, "eventId"),
      id: this.recordValue(record, "id"),
      resourceId: this.recordValue(record, "resourceId"),
      resourceType: this.recordValue(record, "resourceType"),
      serverSequence: this.recordValue(record, "serverSequence"),
      syncType: this.recordValue(record, "syncType"),
      updatedAt: this.isoDate(this.recordValue(record, "updatedAt"))
    }
  }

  /**
   * Reads and parses the record data payload.
   * @param {?} record - Sync/change record.
   * @returns {unknown} Parsed data value.
   */
  recordData(record) {
    const data = this.recordValue(record, "data")

    if (data === "" || data === null || data === undefined) return null
    if (typeof data !== "string") return data

    return JSON.parse(data)
  }

  /**
   * Reads a value from either a record accessor method or plain property.
   * @param {?} record - Sync/change record.
   * @param {string} name - Camel-cased value/method name.
   * @returns {unknown} Record value.
   */
  recordValue(record, name) {
    if (!record || typeof record !== "object") {
      throw VelociousError.safe("Sync changes row must be an object.", {code: "sync-invalid-changes-row"})
    }

    const recordObject = /** @type {Record<string, ?>} */ (record)
    const method = recordObject[name]
    const value = typeof method === "function" ? method.call(record) : method

    if (value === undefined) {
      throw VelociousError.safe(`Sync changes row is missing ${name}.`, {code: "sync-invalid-changes-row"})
    }

    return value
  }

  /**
   * Converts a date-like value to an ISO string.
   * @param {Date | string | null | undefined | unknown} value - Date value.
   * @returns {string} ISO date.
   */
  isoDate(value) {
    const date = value instanceof Date ? value : new Date(typeof value === "string" || typeof value === "number" ? value : 0)

    if (Number.isNaN(date.getTime())) {
      throw VelociousError.safe("Sync changes row has an invalid updated_at value.", {code: "sync-invalid-changes-row"})
    }

    return date.toISOString()
  }
}

