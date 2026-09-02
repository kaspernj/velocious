// @ts-check

import BaseForeignKey from "../base-foreign-key.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMssqlForeignKey extends BaseForeignKey {
  getColumnName() { return digg(this, "data", "ParentColumn") }
  getName() { return digg(this, "data", "CONSTRAINT_NAME") }
  getTableName() { return digg(this, "data", "TableName") }
  getReferencedColumnName() { return digg(this, "data", "ReferencedColumn") }
  getReferencedTableName() { return digg(this, "data", "ReferencedTable") }
}
