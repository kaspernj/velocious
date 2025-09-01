import {digg} from "diggerize"

export default class VelociousDatabaseDriversMssqlForeignKey {
  constructor(data) {
    this.data = data
  }

  getColumnName = () => digg(this, "data", "ParentColumn")
  getName = () => digg(this, "data", "CONSTRAINT_NAME")
  getTableName = () => digg(this, "data", "TableName")
  getReferencedColumnName = () => digg(this, "data", "ReferencedColumn")
  getReferencedTableName = () => digg(this, "data", "ReferencedTable")
}
