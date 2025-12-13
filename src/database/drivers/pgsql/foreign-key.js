// @ts-check

import BaseForeignKey from "../base-foreign-key.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlForeignKey extends BaseForeignKey {
  getColumnName() { return digg(this, "data", "column_name") }
  getName() { return digg(this, "data", "constraint_name") }
  getTableName() { return digg(this, "data", "table_name") }
  getReferencedColumnName() { return digg(this, "data", "foreign_column_name") }
  getReferencedTableName() { return digg(this, "data", "foreign_table_name") }
}
