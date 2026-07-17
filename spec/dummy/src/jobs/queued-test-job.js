import VelociousJob from "../../../../src/background-jobs/job.js"

export default class QueuedTestJob extends VelociousJob {
  static queue = "builds"

  async perform() {}
}
