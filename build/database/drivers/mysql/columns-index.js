// @ts-check

import BaseColumnsIndex from "../base-columns-index.js"
import {digg} from "diggerize"
import TableIndex from "../../table-data/table-index.js"

export default class VelociousDatabaseDriversMysqlColumnsIndex extends BaseColumnsIndex {
  getColumnNames() {
    const columnNames = digg(this, "data", "column_names")

    if (columnNames) return columnNames

    return [digg(this, "data", "COLUMN_NAME")]
  }

  getTableDataIndex() {
    return new TableIndex(this.getColumnNames(), {
      name: this.getName(),
      unique: this.isUnique()
    })
  }
}
