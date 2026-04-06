import BaseResource from "../../../../src/authorization/base-resource.js"
import Task from "../models/task.js"

export default class TaskFrontendModelAbilityResource extends BaseResource {
  static ModelClass = Task

  /** @returns {void} */
  abilities() {
    const applyReadDistinctScope = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_READ_DISTINCT_SCOPE === "1"
    const applySubqueryScope = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_SUBQUERY_SCOPE

    if (applyReadDistinctScope) {
      this.can(["destroy", "update"])
      this.can("read", (query) => query.distinct(true))
    } else if (applySubqueryScope) {
      this.can(["create", "destroy", "read", "update"], (query) => {
        query.where(`tasks.project_id IN (SELECT projects.id FROM projects WHERE projects.creating_user_reference = ${query.driver.quote(applySubqueryScope)})`)
      })
    } else {
      this.can(["destroy", "read", "update"])
    }

    const deniedAction = process.env.VELOCIOUS_DUMMY_FRONTEND_MODEL_DENY_ACTION

    if (deniedAction === "destroy" || deniedAction === "read" || deniedAction === "update") {
      this.cannot(deniedAction)
    }
  }
}
