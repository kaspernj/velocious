// @ts-check

import DatabaseRecord from "../database/record/index.js"

export default class BackgroundJobRecord extends DatabaseRecord {
  static tableName() {
    return "background_jobs"
  }

  static primaryKey() {
    return "id"
  }
}
