// @ts-check

import VelociousJob from "../background-jobs/job.js"
import {deliverPayload} from "../mailer.js"

/**
 * Background job for delivering mailer payloads.
 */
export default class MailDeliveryJob extends VelociousJob {
  /**
   * @param {import("../mailer.js").MailerDeliveryPayload} [payload] - Mail delivery payload.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async perform(payload) {
    if (!payload) {
      throw new Error(`Missing mail delivery payload. Got: ${String(payload)}`)
    }

    await deliverPayload(payload)
  }
}
