import restArgsError from "../../utils/rest-args-error.js"

export default class TableIndex {
  constructor(columns, args) {
    if (args) {
      const {name, unique, ...restArgs} = args // eslint-disable-line no-unused-vars

      restArgsError(restArgs)
    }

    this.args = args
    this.columns = columns
  }

  getColumns() { return this.columns }
  getName() { return this.args?.name }
  getUnique() { return Boolean(this.args?.unique) }
}
