import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteColumn {
  constructor({column, driver}) {
    this.column = column
    this.driver = driver
  }

  getName = () => digg(this, "column", "name")
}
