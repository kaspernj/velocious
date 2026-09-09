// @ts-check

import VelociousJob from "../../../../src/background-jobs/job.js"

/** Child queued by the retired-generation ownership regression. */
export default class RetiredOwnedFollowUpTestChildJob extends VelociousJob {
  /**
   * @param {string} _message - Serialized child payload.
   * @returns {Promise<void>} - Resolves immediately.
   */
  async perform(_message) {}
}
