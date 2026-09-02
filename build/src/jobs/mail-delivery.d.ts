import VelociousJob from "../background-jobs/job.js";
/**
 * Background job for delivering mailer payloads.
 * @augments {VelociousJob<[import("../mailer.js").MailerDeliveryPayload]>}
 */
export default class MailDeliveryJob extends VelociousJob<[import("../mailer.js").MailerDeliveryPayload]> {
    /**
     * Runs perform.
     * @param {import("../mailer.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    perform(payload: import("../mailer.js").MailerDeliveryPayload): Promise<void>;
}
//# sourceMappingURL=mail-delivery.d.ts.map