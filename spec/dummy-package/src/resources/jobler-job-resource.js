import BaseResource from "../../../../src/authorization/base-resource.js"
import JoblerJob from "../models/jobler-job.js"

export default class JoblerJobResource extends BaseResource {
  static ModelClass = JoblerJob

  /** @returns {void} */
  abilities() {
    this.can(["read"])
  }
}
