// @ts-check

import OrderBase from "./order-base.js"

/**
 * OrderColumnInput type.
 * @typedef {object} OrderColumnInput
 * @property {string} column - Column name.
 * @property {"ASC" | "DESC" | "asc" | "desc"} [direction] - Sort direction.
 * @property {string} [tableName] - Optional table or alias name.
 */

/**
 * Runs normalize direction.
 * @param {string | undefined} direction - Direction input.
 * @returns {"ASC" | "DESC"} - Normalized direction.
 */
function normalizeDirection(direction) {
  if (typeof direction == "undefined") return "ASC"

  const normalized = direction.toUpperCase()
  if (normalized == "ASC" || normalized == "DESC") return normalized

  throw new Error(`Invalid order direction: ${direction}`)
}

/**
 * Runs reverse direction.
 * @param {"ASC" | "DESC"} direction - Direction.
 * @returns {"ASC" | "DESC"} - Reversed direction.
 */
function reverseDirection(direction) {
  return direction == "ASC" ? "DESC" : "ASC"
}

export default class VelociousDatabaseQueryOrderColumn extends OrderBase {
  /**
   * Runs constructor.
   * @param {import("./index.js").default} query - Query instance.
   * @param {OrderColumnInput} input - Column order input.
   */
  constructor(query, input) {
    super(query)

    if (!input.column) throw new Error("Order column is required")

    this.column = input.column
    this.direction = normalizeDirection(input.direction)
    this.reverseOrder = false
    this.tableName = input.tableName
  }

  /**
   * Runs set reverse order.
   * @param {boolean} [reverseOrder] - Whether to reverse the order.
   * @returns {void}
   */
  setReverseOrder(reverseOrder = true) {
    this.reverseOrder = reverseOrder
  }

  /**
   * Runs to sql.
   * @returns {string} - SQL string.
   */
  toSql() {
    const options = this.getOptions()
    const direction = this.reverseOrder ? reverseDirection(this.direction) : this.direction
    let sql = ""

    if (this.tableName) sql += `${options.quoteTableName(this.tableName)}.`

    sql += `${options.quoteColumnName(this.column)} ${direction}`

    return sql
  }
}
