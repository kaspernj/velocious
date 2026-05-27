import VelociousJob from "../../../../src/background-jobs/job.js"

export default class FailingJob extends VelociousJob {
  async perform(message = "background job failed") {
    throw new Error(message)
  }
}
