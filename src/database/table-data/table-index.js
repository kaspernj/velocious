// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

/**
 * @typedef {object} TableIndexArgsType
 * @property {string} [name]
 * @property {boolean} [unique]
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
   * @returns {Array<string | import("./table-column.js").default>}
   */
  getColumns() { return this.columns }

  /**
   * @returns {string | undefined}
   */
  getName() { return this.args?.name }

  /**
   * @returns {boolean}
   */
  getUnique() { return Boolean(this.args?.unique) }
}
