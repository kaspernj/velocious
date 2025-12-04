import TableColumn from "./table-column.js"
import TableIndex from "./table-index.js"
import TableReference from "./table-reference.js"

export default class TableData {
  _columns = []
  _foreignKeys = []
  _indexes = []
  _references = []

  /**
   * @param {string} name
   * @param {object} args
   */
  constructor(name, args = {}) {
    if (!name) throw new Error(`Invalid table name: ${name}`)

    this.args = args
    this._name = name
  }

  /**
   * @param {string} name
   * @param {object} args
   */
  addColumn(name, args = {}) {
    if (name instanceof TableColumn) {
      this.getColumns().push(name)
    } else {
      const column = new TableColumn(name, args)

      this.getColumns().push(column)
    }
  }

  /**
   * @returns {TableColumn[]}
   */
  getColumns() { return this._columns }

  /**
   * @param {import("./table-foreign-key.js").default} foreignKey
   */
  addForeignKey(foreignKey) { this._foreignKeys.push(foreignKey) }

  /**
   * @returns {import("./table-foreign-key.js").default[]}
   */
  getForeignKeys() { return this._foreignKeys }

  /**
   * @param {TableIndex} index
   */
  addIndex(index) { this._indexes.push(index) }

  /**
   * @returns {TableIndex[]}
   */
  getIndexes() { return this._indexes }

  /**
   * @returns {string}
   */
  getName() { return this._name }

  /**
   * @param {string} newName
   * @returns {void}
   */
  setName(newName) { this._name = newName }

  /**
   * @returns {boolean}
   */
  getIfNotExists() { return this.args.ifNotExists }

  /**
   * @returns {TableReference[]}
   */
  getReferences() { return this._references }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  bigint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "bigint"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  blob(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "blob"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  boolean(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "boolean"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  datetime(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "datetime"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  integer(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "integer"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  tinyint(name, args = {}) { this.addColumn(name, Object.assign({isNewColumn: true, type: "tinyint"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  references(name, args = {}) {
    const columnName = `${name}_id`
    const reference = new TableReference(name, args)
    const {polymorphic, ...restArgs} = args
    const columnArgs = Object.assign({isNewColumn: true, type: "bigint"}, restArgs)
    const column = new TableColumn(columnName, columnArgs)
    const index = new TableIndex([column])

    this.getColumns().push(column)
    this.getIndexes().push(index)
    this.getReferences().push(reference)

    if (polymorphic) {
      const typeColumnName = `${name}_type`
      const typeColumn = new TableColumn(typeColumnName, {isNewColumn: true, type: "string"})

      this.getColumns().push(typeColumn)
    }
  }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  string(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "string"}, args)) }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  text(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "text"}, args)) }

  /**
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  timestamps(args = {}) {
    this.datetime("created_at", args)
    this.datetime("updated_at", args)
  }

  /**
   * @param {string} name
   * @param {object} args
   * @param {boolean} args.autoIncrement
   * @param {any} args.default
   * @param {boolean} args.dropColumn
   * @param {boolean|object} args.foreignKey
   * @param {boolean|object} args.index
   * @param {number} args.maxLength
   * @param {boolean} args.null
   * @param {boolean} args.primaryKey
   * @returns {void}
   */
  uuid(name, args) { this.addColumn(name, Object.assign({isNewColumn: true, type: "uuid"}, args)) }
}
