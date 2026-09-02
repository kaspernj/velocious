// @ts-check

import VelociousJob from "../background-jobs/job.js"
import {deliverPayload} from "../mailer.js"

/**
 * Background job for delivering mailer payloads.
 * @augments {VelociousJob<[import("../mailer.js").MailerDeliveryPayload]>}
 */
export default class MailDeliveryJob extends VelociousJob {
  /**
   * Runs perform.
   * @param {import("../mailer.js").MailerDeliveryPayload} payload - Mail delivery payload.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async perform(payload) {
    await deliverPayload(payload)
  }
}
