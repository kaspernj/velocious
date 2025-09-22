import BaseForeignKey from "../base-foreign-key.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMysqlForeignKey extends BaseForeignKey {
  getColumnName() { return digg(this, "data", "COLUMN_NAME") }
  getName() { return digg(this, "data", "CONSTRAINT_NAME") }
  getTableName() { return digg(this, "data", "TABLE_NAME") }
  getReferencedColumnName() { return digg(this, "data", "REFERENCED_COLUMN_NAME") }
  getReferencedTableName() { return digg(this, "data", "REFERENCED_TABLE_NAME") }
}
