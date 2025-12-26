// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

/**
 * @typedef {object} TableIndexArgsType
 * @property {string} [name] - Description.
 * @property {boolean} [unique] - Description.
 */

export default class TableIndex {
  /**
   * @param {Array<string | import("./table-column.js").default>} columns
   * @param {TableIndexArgsType} [args]
   */
  constructor(columns, args) {
    if (args) {
      const {name, unique, ...restArgs} = args // eslint-disable-line no-unused-vars

      restArgsError(restArgs)
    }

    this.args = args
    this.columns = columns
  }

  /**
   * @returns {Array<string | import("./table-column.js").default>} - Result.
   */
  getColumns() { return this.columns }

  /**
   * @returns {string | undefined} - Result.
   */
  getName() { return this.args?.name }

  /**
   * @returns {boolean} - Result.
   */
  getUnique() { return Boolean(this.args?.unique) }
}
