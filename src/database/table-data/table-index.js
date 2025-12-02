import restArgsError from "../../utils/rest-args-error.js"

export default class TableIndex {
  /**
   * @param {Array<string>} columns
   * @param {object} args
   * @param {string} args.name
   * @param {boolean} args.unique
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
   * @returns {Array<string>}
   */
  getColumns() { return this.columns }

  /**
   * @returns {string}
   */
  getName() { return this.args?.name }

  /**
   * @returns {boolean}
   */
  getUnique() { return Boolean(this.args?.unique) }
}
